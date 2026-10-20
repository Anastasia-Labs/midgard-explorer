import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { admitEvidenceProvenance, assertSecurityGradeEvidence } from "@al-ft/midgard-sdk";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { controlKey } from "../src/archive/keys.js";
import { readHead } from "../src/archive/reader.js";
import { runIngest } from "../ingest/run.js";
import type { PayloadSource } from "../ingest/ingestBlock.js";

/**
 * A `pnpm ingest` run publishes what it archived, and only that, and a second
 * identical run changes nothing.
 */

const FP = "ab".repeat(32);
type Block = { headerHash: string; identity: string };
const { blocks } = JSON.parse(
  readFileSync(new URL("./fixtures/da-payloads-f4cf28ca1.json", import.meta.url), "utf8"),
) as { blocks: [Block, Block] };
const [a, b] = blocks;
const MISSING = "00".repeat(28);

/** Serves each fixture block under its own header, and nothing for any other. */
const source: PayloadSource = {
  sourceId: "stub",
  async fetchPayloadByHeaderHash(headerHash, options) {
    const block = blocks.find((x) => x.headerHash === headerHash);
    if (!block) {
      return { ok: false, sourceId: "stub", attempts: [{ sourceId: "stub", sourcePeerId: "p", protocol: "payload-by-header", status: "not_found", detail: "" }] };
    }
    const payloadEnvelopeCbor = Buffer.from(block.identity, "hex");
    await options?.verifyPayload?.(payloadEnvelopeCbor);
    return {
      ok: true,
      sourceId: "stub",
      sourcePeerId: "p",
      payloadEnvelopeCbor,
      metadata: {},
      attempts: [],
      provenance: assertSecurityGradeEvidence(
        admitEvidenceProvenance({
          provenance: { trustClass: "public_or_permissionless_da", sourceId: "stub/p", grade: "security" },
        }),
      ),
    };
  },
};

const run = (store: FsArchiveStore, headerHashes: string[]) =>
  runIngest({
    store,
    fingerprint: FP,
    headerHashes,
    sources: [source],
    limits: { maxPayloadBytes: 64 * 1024 * 1024 },
    retries: 0,
    owner: "test",
    leaseMs: 60_000,
  });

describe("an ingest run", () => {
  it("publishes the blocks it archived and none it could not", async () => {
    const store = new FsArchiveStore(mkdtempSync(join(tmpdir(), "run-")));
    const report = await run(store, [a.headerHash, MISSING]);
    expect(report.results.map((r) => r.state)).toEqual(["archived", "failed"]);
    const head = await readHead(store, FP);
    const manifests = head!.generation.references.filter((k) => k.includes("/blocks/"));
    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toContain(a.headerHash);
  });

  it("is a no-op when repeated, and a later run keeps what earlier ones published", async () => {
    const store = new FsArchiveStore(mkdtempSync(join(tmpdir(), "run-")));
    await run(store, [a.headerHash]);
    const first = await readHead(store, FP);
    expect((await run(store, [a.headerHash])).published).toBe(false);
    expect((await readHead(store, FP))!.key).toBe(first!.key);

    await run(store, [b.headerHash]);
    const later = await readHead(store, FP);
    expect(later!.generation.n).toBe(2);
    for (const block of [a, b]) {
      expect(later!.generation.references.some((k) => k.includes(`/blocks/${block.headerHash}`))).toBe(true);
    }
  });
});

describe("the lease across runs", () => {
  /** Two `pnpm ingest` invocations one after the other, each its own process
   * and its own owner. The first must release, or the second waits out the
   * lease. */
  it("lets a second process start immediately after the first finishes", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-"));
    const backend = resolve(import.meta.dirname, "..");
    const child = (hash: string) =>
      spawnSync(
        join(backend, "node_modules/.bin/ts-node"),
        ["--transpile-only", "test/helpers/ingestRunChild.ts", dir, FP, hash],
        { cwd: backend, encoding: "utf8", timeout: 60_000 },
      );
    const first = child(a.headerHash);
    expect(first.stdout.trim(), first.stderr).toBe("archived true");
    const second = child(b.headerHash);
    expect(second.stdout.trim(), second.stderr).toBe("archived true");
  }, 120_000);

  /** A run longer than its lease keeps it by renewing, and still publishes. */
  it("renews the lease during a run that outlasts it", async () => {
    const store = new FsArchiveStore(mkdtempSync(join(tmpdir(), "run-")));
    const slow: PayloadSource = {
      sourceId: "slow",
      async fetchPayloadByHeaderHash(headerHash, options) {
        await new Promise((r) => setTimeout(r, 900));
        return source.fetchPayloadByHeaderHash(headerHash, options);
      },
    };
    const report = await runIngest({
      store,
      fingerprint: FP,
      headerHashes: [a.headerHash],
      sources: [slow],
      limits: { maxPayloadBytes: 64 * 1024 * 1024 },
      retries: 0,
      owner: "slow",
      leaseMs: 300,
    });
    expect(report.published).toBe(true);
  });
});

describe("a renewal that throws", () => {
  /** The renewal runs on a timer. If it throws, the run must still stop
   * publishing and still release, with no unhandled rejection. */
  it("stops the run without publishing, and the lease is still released", async () => {
    const inner = new FsArchiveStore(mkdtempSync(join(tmpdir(), "run-")));
    let renewals = 0;
    const store = Object.create(inner) as FsArchiveStore;
    store.putIfMatch = async (key, bytes, etag) => {
      const next = JSON.parse(new TextDecoder().decode(bytes));
      const releasing = next.lease?.expiresAt === 0;
      const acquiring = etag === null;
      if (key === controlKey(FP) && !releasing && !acquiring) {
        renewals += 1;
        throw new Error("disk went away");
      }
      return inner.putIfMatch(key, bytes, etag);
    };
    const slow: PayloadSource = {
      sourceId: "slow",
      async fetchPayloadByHeaderHash(headerHash, options) {
        await new Promise((r) => setTimeout(r, 400));
        return source.fetchPayloadByHeaderHash(headerHash, options);
      },
    };
    await expect(
      runIngest({
        store,
        fingerprint: FP,
        headerHashes: [a.headerHash],
        sources: [slow],
        limits: { maxPayloadBytes: 64 * 1024 * 1024 },
        retries: 0,
        owner: "renewing",
        leaseMs: 150,
      }),
    ).rejects.toThrow(/lease/);
    expect(renewals).toBeGreaterThan(0);
    expect(await readHead(inner, FP)).toBeNull();
    const control = JSON.parse(new TextDecoder().decode((await inner.get(controlKey(FP)))!.bytes));
    expect(control.lease.expiresAt).toBe(0);
  });
});
