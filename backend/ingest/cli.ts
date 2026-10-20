/// <reference path="../src/types/midgard-untyped.d.ts" />
/**
 * `pnpm ingest`: archive DA payloads for named block headers.
 *
 *   pnpm ingest --manifest <path> --archive <dir> --peer <multiaddr> --header <hash> [--header <hash> ...]
 *   pnpm ingest --manifest <path> --archive <dir> --peer <multiaddr> --seed <hash> --seed-source "<where it came from>"
 *
 * --manifest  the deployment manifest (midgard-deployment-manifest-v1); verified
 *             with Midgard's finalized-manifest verifier, and its id is the
 *             archive fingerprint every key carries
 * --archive   the archive directory
 * --peer      a DA peer, /dns4/<host>/tcp/<port>/p2p/<peer id>; repeatable
 * --payloads  instead of peers, a recorded fixture file (da-payloads-*.json)
 *             for local runs; every copy is still verified, and the source is
 *             named fixture:<file> in what is archived
 * --header    a 56-hex block header hash; repeatable
 * --seed      a header to walk back from along prevHeaderHash, to genesis, an
 *             archived header, or a header no peer serves; repeatable, each
 *             with its --seed-source. A seed is never taken to be the tip.
 * --max-blocks, --time-budget-s   bounds on one run's walk (100, 600)
 * --retries   retries per peer while its failures look transient (default 1)
 *
 * Limits come from the manifest's DA transport profile. Nothing is published
 * that failed verification; each failure leaves a marker in the archive.
 */
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { FsArchiveStore } from "../src/archive/fsStore";
import { fixturePayloadSource, readFixtureFile } from "./fixtureSource";
import type { PayloadSource } from "./ingestBlock";
import { retainedDaTransport, type DaPeer } from "./transport";
import { runIngest } from "./run";

const USAGE =
  "usage: pnpm ingest --manifest <path> --archive <dir> (--peer <multiaddr> | --payloads <file>) (--header <hash> | --seed <hash> --seed-source <text>) ...";

type Limits = {
  maxPayloadBytes: number;
  maxInlineResponseBytes: number;
  maxChunkBytes: number;
  requestTimeoutMs: number;
};

const peerOf = (multiaddr: string): DaPeer => {
  const match = multiaddr.match(/^\/dns[46]\/[^/]+\/tcp\/\d+\/p2p\/([1-9A-HJ-NP-Za-km-z]+)$/);
  if (!match) throw new Error(`--peer must be /dns4/<host>/tcp/<port>/p2p/<peer id>, got ${multiaddr}`);
  return { peerId: match[1]!, multiaddr };
};

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      archive: { type: "string" },
      peer: { type: "string", multiple: true },
      payloads: { type: "string" },
      header: { type: "string", multiple: true },
      seed: { type: "string", multiple: true },
      "seed-source": { type: "string", multiple: true },
      "max-blocks": { type: "string", default: "100" },
      "time-budget-s": { type: "string", default: "600" },
      retries: { type: "string", default: "1" },
    },
  });
  const seedHashes = (values.seed ?? []).map((h) => h.toLowerCase());
  const seedSources = values["seed-source"] ?? [];
  if (
    !values.manifest ||
    !values.archive ||
    ((values.peer?.length ?? 0) > 0) === (values.payloads !== undefined) ||
    (!values.header?.length && seedHashes.length === 0) ||
    seedSources.length !== seedHashes.length
  ) {
    console.error(USAGE);
    return 2;
  }
  const headers = (values.header ?? []).map((h) => h.toLowerCase());
  const bad = [...headers, ...seedHashes].find((h) => !/^[0-9a-f]{56}$/.test(h));
  if (bad) {
    console.error(`--header must be 56 hex characters, got ${bad}`);
    return 2;
  }

  // Midgard's own verifier, and nothing of the API server's: the ingester
  // needs no database or server configuration.
  const raw = JSON.parse(readFileSync(values.manifest, "utf8")) as {
    da?: { transportProfile?: { limits?: Partial<Limits> } };
    genesis?: { headerHash?: string };
  };
  const identity = await import("@al-ft/midgard-core/deployment-manifest-identity");
  const fingerprint = identity.verifyFinalizedDeploymentManifest(raw).manifestId;
  const limits = raw.da?.transportProfile?.limits;
  if (!limits?.maxPayloadBytes || !limits.maxInlineResponseBytes || !limits.maxChunkBytes || !limits.requestTimeoutMs) {
    console.error("the manifest carries no complete DA transport profile limits");
    return 2;
  }
  let source: PayloadSource;
  let stop = async () => {};
  if (values.payloads !== undefined) {
    source = fixturePayloadSource(readFixtureFile(values.payloads), basename(values.payloads));
  } else {
    const peers = (values.peer ?? []).map(peerOf);
    const [{ createWatcherPublicDaLibp2pTransport }, faultProofs, daTransport] = await Promise.all([
      import("midgard-watcher"),
      import("@al-ft/midgard-fault-proofs"),
      import("@al-ft/midgard-core/da-transport"),
    ]);
    const watcher = await createWatcherPublicDaLibp2pTransport({ maxFrameBytes: limits.maxPayloadBytes });
    stop = () => watcher.stop();
    source = new faultProofs.DaLibp2pRetainedDaSource({
      deploymentFingerprint: fingerprint,
      peers: peers.map(({ peerId }) => ({ peerId })),
      transport: retainedDaTransport(watcher, daTransport, fingerprint, peers),
      timeoutMs: limits.requestTimeoutMs,
      maxInlineResponseBytes: limits.maxInlineResponseBytes,
      maxChunkBytes: limits.maxChunkBytes,
    });
  }
  try {
    const report = await runIngest({
      store: new FsArchiveStore(values.archive),
      fingerprint: fingerprint,
      headerHashes: headers,
      seeds: seedHashes.map((headerHash, i) => ({ headerHash, source: seedSources[i]! })),
      genesisHeaderHash: raw.genesis?.headerHash,
      maxBlocks: Number(values["max-blocks"]),
      timeBudgetMs: Number(values["time-budget-s"]) * 1000,
      sources: [source],
      limits: { maxPayloadBytes: limits.maxPayloadBytes },
      retries: Number(values.retries),
      owner: `${hostname()}:${process.pid}`,
      leaseMs: 2 * 60_000,
    });
    for (const result of report.results) {
      console.log(
        result.state === "archived"
          ? `archived  ${result.headerHash}`
          : `failed    ${result.headerHash}  ${result.reason}: ${result.detail.slice(0, 300)}`,
      );
    }
    for (const walk of report.walks) {
      console.log(
        `seed      ${walk.seed}  archived ${walk.archived}, stopped: ${walk.stop}${walk.gapAt ? ` at ${walk.gapAt}` : ""}`,
      );
    }
    console.log(report.published ? "published a new generation" : "nothing new to publish");
    return report.results.every((r) => r.state === "archived") ? 0 : 1;
  } finally {
    await stop();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
