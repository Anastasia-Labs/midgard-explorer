import { config } from "../config";
import { prisma } from "../db";
import { indexerPrisma, getSyncCursor } from "../indexer/db";
import { loadManifest } from "../indexer/manifest";
import { logger } from "../logger";

const PAGE_SIZE = 25;

export async function getL1TransactionsPage(
  page: number,
  pageSize = PAGE_SIZE,
) {
  const current = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const skip = (current - 1) * pageSize;

  const [rows, total] = await Promise.all([
    indexerPrisma.l1Tx.findMany({
      // txTime comes from the Cardano block, so every transaction in the same
      // block ties. Without a deterministic tiebreaker, OFFSET/LIMIT can
      // repeat or drop rows across pages once the table exceeds one page.
      orderBy: [{ txTime: "desc" }, { txHash: "desc" }],
      skip,
      take: pageSize,
      include: { events: true },
    }),
    indexerPrisma.l1Tx.count(),
  ]);

  return {
    rows,
    total,
    hasNextPage: skip + rows.length < total,
    limit: pageSize,
  };
}

/**
 * One transaction with every section the indexer stored. Grouped here rather
 * than in the route so the shape is testable without HTTP.
 *
 * Until now this returned the transaction and its Midgard events only, so every
 * input, output, asset and redeemer the indexer writes was unreachable. The
 * sections are split by `kind` rather than returned as one flat list, because a
 * caller that has to filter by kind is a caller that can get the filter wrong.
 */
export async function getL1Transaction(txHash: string) {
  const tx = await indexerPrisma.l1Tx.findUnique({
    where: { txHash },
    include: {
      events: true,
      redeemers: true,
      // Native assets belong to the UTxO they were found in, so they are
      // nested. Mints belong to no UTxO and would be lost by that join, so
      // they come from the ioId-less rows instead.
      ios: {
        include: { assets: true },
        orderBy: [{ kind: "asc" }, { position: "asc" }],
      },
      assets: { where: { ioId: null } },
    },
  });
  if (!tx) return null;

  const { ios, assets, ...rest } = tx;
  const of = (kind: string) => ios.filter((io) => io.kind === kind);

  return {
    ...rest,
    inputs: of("input"),
    outputs: of("output"),
    referenceInputs: of("reference"),
    collateral: of("collateral"),
    // Singular by nature: a transaction returns at most one collateral change
    // output. Stored with kind "collateral_output" and position 0.
    collateralOutput: of("collateral_output")[0] ?? null,
    mints: assets,
  };
}

/** Deposits, newest first. An undecoded deposit is still listed: a decoder gap
 * must be visible rather than silently shortening the list. */
export async function getL1Deposits(limit = 25) {
  const take =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 25;
  return indexerPrisma.l1Event.findMany({
    where: { validator: "deposit" },
    orderBy: [{ id: "desc" }],
    take,
    include: { tx: true },
  });
}

/** Capped the same way the deposits list is. An uncapped limit on a public
 * route lets one request ask for the whole table. */
export async function getL1BlockHeaders(limit: number) {
  return indexerPrisma.l1BlockHeader.findMany({
    orderBy: [{ endTime: "desc" }, { headerHash: "desc" }],
    take:
      Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 100)
        : 25,
  });
}

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
  isFixture: boolean;
  validators: Array<{
    entryName: string;
    family: string;
    scriptHash: string;
    address: string;
  }>;
};

/** Read once. The manifest is a file written at deployment time and does not
 * change while the process runs, so reading and parsing it per request was
 * blocking the event loop to re-learn the same answer.
 *
 * Only a resolved identity is kept. A failure is transient by nature, and
 * memoising it would pin "unconfirmed" on every page until the next restart. */
let identity: SourceIdentity | null = null;

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
  if (identity) return identity;
  try {
    const { manifestId, network, createdAt, validators } = loadManifest(
      config.MIDGARD_MANIFEST_PATH,
    );
    const [row] = await prisma.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db;`;
    if (!row?.db) throw new Error("the connection did not name its database");
    identity = {
      deployment: manifestId,
      network,
      deployedAt: createdAt,
      l2Database: row.db,
      isFixture: isFixtureDatabase(row.db),
      validators,
    };
  } catch (err) {
    logger.error(`Could not identify the data source: ${String(err)}`);
    return null;
  }
  return identity;
}

/** Tests only: the memo would otherwise outlive a changed configuration. */
export function resetSourceIdentity(): void {
  identity = null;
}

export async function getL1Summary() {
  const [transactions, events, blockHeaders, cursor, grouped] =
    await Promise.all([
      indexerPrisma.l1Tx.count(),
      indexerPrisma.l1Event.count(),
      indexerPrisma.l1BlockHeader.count(),
      getSyncCursor("l1"),
      indexerPrisma.l1Event.groupBy({
        by: ["validator"],
        _count: { validator: true },
      }),
    ]);

  return {
    source: await getSourceIdentity(),
    transactions,
    events,
    blockHeaders,
    lastSyncedHeight: cursor?.lastBlockHeight ?? null,
    byValidator: grouped
      .map((g) => ({ validator: g.validator, count: g._count.validator }))
      .sort((a, b) => b.count - a.count),
  };
}
