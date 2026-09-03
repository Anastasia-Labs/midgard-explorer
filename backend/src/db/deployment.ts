import { config } from "../config";
import { prisma } from "../db";
import {
  SYNC_SOURCES,
  getSyncCursorTimes,
  getSyncCursors,
  readIndexConsistently,
  indexerPrisma,
  reconciliationAgeSeconds,
} from "../indexer/db";
import { loadManifest } from "../indexer/manifest";
import { checkBinding } from "../indexer/binding";
import { logger } from "../logger";
import { readL2Source, type L2FreshnessState, type L2SourceKind } from "./source";
import type { DeploymentContext } from "./association";

/**
 * Which deployment a response describes, and how current its source is.
 *
 * Split out of `db/l1.ts`, which had grown to answer two unrelated questions:
 * what the Cardano index holds, and which deployment this process is reading.
 * They share a database and nothing else, and the second is consulted by routes
 * that never touch the first.
 *
 * A pure move. Every function here is byte-identical to what it replaced, which
 * is what makes the change reviewable: the suite passing means the split is
 * behaviour-neutral, and any behaviour change would be a separate commit.
 */

/**
 * Anything that is not the live node database is a fixture, and the page must
 * say so. Named by exclusion rather than by an allowlist of known fixtures: a
 * new fixture must not be able to present itself as live simply by not being
 * on a list. The explorer spent weeks reporting a phase-4 test database as the
 * live chain, and no diff could show it, because the name lived in a .env.
 */
export function isFixtureDatabase(name: string): boolean {
  return name !== "midgard";
}

export type SourceIdentity = {
  deployment: string | null;
  network: string;
  deployedAt: string;
  l2Database: string;
  /** Retained for one release. `sourceKind` is the field to read: this one
   * cannot tell a restored snapshot of real data from synthetic fixture data,
   * and reports both as fixture. */
  isFixture: boolean;
  /** What this process is actually reading, asked of PostgreSQL rather than
   * derived from the configured URL. */
  sourceKind: L2SourceKind;
  freshness: {
    state: L2FreshnessState;
    observedAsOf: string | null;
    lagSeconds: number | null;
  };
  validators: Array<{
    entryName: string;
    family: string;
    scriptHash: string;
    address: string;
  }>;
};

/**
 * Cached briefly, not forever.
 *
 * The whole identity object used to be memoised for the process lifetime, and
 * it carries `freshness`, which is the one part that changes by the second. A
 * replica that fell an hour behind therefore kept reporting the lag it had at
 * the first request after boot, and the staler it got the more confidently
 * current it looked. Freezing a freshness reading is worse than not having one.
 *
 * A few seconds is enough to stop a burst of requests re-probing the same
 * answer, and short enough that nothing on screen is meaningfully out of date.
 * A failure is not cached at all: it is transient by nature, and remembering it
 * would pin "unconfirmed" on every page until the next restart.
 */
const IDENTITY_TTL_MS = 5_000;
let identity: SourceIdentity | null = null;
let identityAt = 0;

/** Which deployment these figures describe and which database they came from.
 * The boot log already names the database, which protects an operator. This is
 * the same fact where a viewer can see it.
 *
 * The database name comes from the server, not from `config`. The configured
 * name says which database was asked for, and the incident this banner exists
 * to prevent was a .env whose name did not match the connection, so echoing it
 * back would confirm nothing. `db/identity.ts` asks the same question at boot.
 *
 * Returns null rather than throwing when the manifest or the connection cannot
 * be read. The summary route is documented to answer whether or not anything
 * else is up, and a consumer that receives no source must treat it as
 * unconfirmed rather than as live, which is what the null case in the contract
 * is for. */
export async function getSourceIdentity(): Promise<SourceIdentity | null> {
  if (identity && Date.now() - identityAt < IDENTITY_TTL_MS) return identity;
  try {
    const { deploymentId, network, createdAt, validators } = loadManifest(
      config.MIDGARD_MANIFEST_PATH,
    );
    const source = await readL2Source();
    identity = {
      deployment: deploymentId,
      network,
      deployedAt: createdAt,
      l2Database: source.database,
      isFixture: isFixtureDatabase(source.database),
      sourceKind: source.kind,
      freshness: {
        state: source.freshness,
        observedAsOf: source.observedAsOf,
        lagSeconds: source.lagSeconds,
      },
      validators,
    };
    identityAt = Date.now();
  } catch (err) {
    logger.error(`Could not identify the data source: ${String(err)}`);
    return null;
  }
  return identity;
}

/** Tests only: the memo would otherwise outlive a changed configuration. */
export function resetSourceIdentity(): void {
  identity = null;
  identityAt = 0;
}

export async function getDeploymentContext(): Promise<DeploymentContext> {
  const identity = await getSourceIdentity();
  if (identity === null) {
    return {
      deploymentId: null,
      network: "unknown",
      networkMagic: null,
      database: "unknown",
      sourceKind: "fixture",
      identityState: "degraded",
      freshness: { state: "unknown", observedAsOf: null, lagSeconds: null },
    };
  }
  // `verified` means the index CONFIRMS it belongs to this deployment, not that
  // a manifest parsed. It was a literal, so every response claimed verification
  // whether or not a binding existed, and `mismatch` was therefore never
  // reserved for two deployment-verified sources the way the contract says.
  let identityState: "verified" | "degraded" = "degraded";
  try {
    const check = await checkBinding(
      loadManifest(config.MIDGARD_MANIFEST_PATH),
      identity.l2Database,
    );
    identityState = check.state === "bound" ? "verified" : "degraded";
  } catch (error) {
    logger.warn(`Could not confirm the deployment binding: ${String(error)}`);
  }

  return {
    deploymentId: identity.deployment,
    network: identity.network,
    networkMagic: null,
    database: identity.l2Database,
    sourceKind: identity.sourceKind,
    identityState,
    freshness: identity.freshness,
  };
}

/**
 * What the Cardano index observed for one block, and how far behind it is.
 *
 * Never throws. An index that cannot be read is silence, not a denial, and the
 * resolver turns that into `unavailable` or `node_only` rather than into a
 * failed request: an L1 outage must not make an L2 page unavailable, which is
 * the same rule the readiness split enforces.
 */
export async function getIndexSettlement(headerHash: string): Promise<{
  indexHash: string | null;
  indexObservedAt: string | null;
  indexBlockHeight: number | null;
  indexAvailable: boolean;
  indexLagSeconds: number | null;
}> {
  try {
    // One snapshot of the index, not three reads of it. A pass committing
    // between the header read and the cursor read used to produce "no header,
    // and the index is current", which reads as a settlement that did not
    // happen rather than one recorded a moment ago.
    const { header, cursors, cursorTimes } = await readIndexConsistently(async (tx) => ({
      header: await tx.l1BlockHeader.findUnique({ where: { headerHash } }),
      cursors: await getSyncCursors(tx),
      cursorTimes: await getSyncCursorTimes(tx),
    }));

    // Freshness comes from an observation clock, not from a height.
    //
    // This used to return 0 whenever coverage was non-zero, which made every
    // built index look perfectly current. `stale` was therefore unreachable and
    // every lagging disagreement was promoted to `mismatch`, which is exactly
    // the false integrity alarm the state exists to prevent. Null now means the
    // index has never completed a pass, and the resolver treats null as "not
    // comparable" rather than as "fresh".
    const covered = Math.min(...SYNC_SOURCES.map((s) => cursors.get(s) ?? 0));
    const lagSeconds = covered > 0 ? reconciliationAgeSeconds(cursorTimes) : null;

    // When the INDEX last had something true to say, not when the L2 block's
    // window closed. `endTime` describes the Midgard block and says nothing
    // about when Cardano was observed, so labelling it "as of" misdescribed
    // every row it appeared on.
    const observedAt =
      covered > 0 && cursorTimes.size > 0
        ? new Date(
            Math.min(...[...cursorTimes.values()].map((at) => at.getTime())),
          ).toISOString()
        : null;

    return {
      indexHash: header?.l1TxHash ?? null,
      indexObservedAt: observedAt,
      indexBlockHeight: header?.blockHeight ?? null,
      indexAvailable: true,
      indexLagSeconds: lagSeconds,
    };
  } catch (error) {
    logger.warn(`Cardano index unavailable for header ${headerHash}: ${String(error)}`);
    return {
      indexHash: null,
      indexObservedAt: null,
      indexBlockHeight: null,
      indexAvailable: false,
      indexLagSeconds: null,
    };
  }
}
