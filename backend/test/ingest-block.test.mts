import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DaPayloadContentEncoding,
  encodeDaPayloadEnvelope,
  unwrapDaPayload,
} from "@al-ft/midgard-core/da-payload-envelope";
import { zstdCompressSync } from "node:zlib";
import { admitEvidenceProvenance, assertSecurityGradeEvidence } from "@al-ft/midgard-sdk";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { ingestBlock, type PayloadSource } from "../ingest/ingestBlock.js";

/**
 * One block, from a served DA payload to the archive.
 *
 * Every copy is checked with Midgard's own header verifier before anything is
 * written. A copy that fails is never published and leaves a failure marker.
 * The block manifest is written last, so a run that dies before it leaves no
 * manifest, and the next run completes the block. The fixtures are empty
 * blocks built by Midgard's own `buildPayloadFixture` at f4cf28ca1.
 */

const FP = "ab".repeat(32);
type Block = { headerHash: string; prevHeaderHash: string; identity: string; zstd: string };
const { blocks } = JSON.parse(
  readFileSync(new URL("./fixtures/da-payloads-f4cf28ca1.json", import.meta.url), "utf8"),
) as { blocks: [Block, Block] };
const [a, b] = blocks;
const LIMITS = { maxPayloadBytes: 64 * 1024 * 1024 };

/** A source that serves the given bytes for any header, and counts its calls. */
const serving = (hex: string): PayloadSource & { calls: number } => {
  const source = {
    sourceId: "stub",
    calls: 0,
    async fetchPayloadByHeaderHash(_headerHash: string, options?: { verifyPayload?: (b: Buffer) => Promise<{ ok: boolean }> }) {
      source.calls += 1;
      const payloadEnvelopeCbor = Buffer.from(hex, "hex");
      const verdict = await options?.verifyPayload?.(payloadEnvelopeCbor);
      if (verdict && !verdict.ok) {
        return { ok: false as const, sourceId: "stub", attempts: [{ sourceId: "stub", sourcePeerId: "peer", protocol: "payloadByHeader", status: "failed_verification" as const, detail: "stub" }] };
      }
      return {
        ok: true as const,
        sourceId: "stub",
        sourcePeerId: "peer",
        payloadEnvelopeCbor,
        metadata: {},
        attempts: [],
        // Built as Midgard's libp2p source builds it.
        provenance: assertSecurityGradeEvidence(
          admitEvidenceProvenance({
            provenance: { trustClass: "public_or_permissionless_da", sourceId: "stub/peer", grade: "security" },
          }),
        ),
      };
    },
  };
  return source as unknown as PayloadSource & { calls: number };
};

/** A source whose every attempt times out. */
const timingOut = () => {
  const source = {
    sourceId: "slow",
    calls: 0,
    async fetchPayloadByHeaderHash() {
      source.calls += 1;
      return {
        ok: false as const,
        sourceId: "slow",
        attempts: [{ sourceId: "slow", sourcePeerId: "peer", protocol: "payloadByHeader", status: "timeout" as const, detail: "stub" }],
      };
    },
  };
  return source as unknown as PayloadSource & { calls: number };
};

const archive = () => new FsArchiveStore(mkdtempSync(join(tmpdir(), "ingest-")));
const run = (store: FsArchiveStore, headerHash: string, source: PayloadSource, extra = {}) =>
  ingestBlock({ store, fingerprint: FP, headerHash, sources: [source], limits: LIMITS, retries: 1, ...extra });

/** The manifest key of a block that must have been archived. */
const manifestOf = (result: Awaited<ReturnType<typeof run>>): string => {
  if (result.state !== "archived") throw new Error(`not archived: ${result.reason} ${result.detail}`);
  return result.manifestKey;
};

const innerSha = async (hex: string) =>
  createHash("sha256")
    .update((await unwrapDaPayload(Buffer.from(hex, "hex"), LIMITS)).innerBytes)
    .digest("hex");

describe("a verified payload", () => {
  it("is archived with its manifest, written last, stating exactly what was verified", async () => {
    const store = archive();
    const result = await run(store, a.headerHash, serving(a.identity));
    expect(result.state).toBe("archived");
    const manifest = JSON.parse(new TextDecoder().decode((await store.get(manifestOf(result)))!.bytes));
    expect(manifest).toMatchObject({
      headerHash: a.headerHash,
      prevHeaderHash: a.prevHeaderHash,
      payloadSha256: await innerSha(a.identity),
      verification: {
        payloadHash: "pass",
        headerBinding: "pass",
        commitment: "not_run",
        roots: { state: "not_run", reason: "no_authenticated_l1_header_observation" },
        l1: "not_observed",
      },
    });
    expect(await store.get(manifest.payloadKey)).not.toBeNull();
    // The verified header, as the payload carries it: pages are built from
    // this, never from the payload at request time.
    expect(manifest.header).toMatchObject({
      prevHeaderHash: a.prevHeaderHash,
      utxosRoot: expect.stringMatching(/^[0-9a-f]+$/),
      startTime: expect.stringMatching(/^\d+$/),
      endTime: expect.stringMatching(/^\d+$/),
      l2TransactionCount: "0",
    });
    // The fixture block carries no records; each kind is paged, with none.
    expect(manifest.records).toEqual({
      transactions: { records: 0, pages: 0 },
      deposits: { records: 0, pages: 0 },
      withdrawals: { records: 0, pages: 0 },
      forced_transactions: { records: 0, pages: 0 },
    });
    expect(await store.list(`${FP}/failures/`)).toEqual([]);
  });

  it("is archived once, the same way, whether it was served raw or zstd-compressed", async () => {
    const store = archive();
    const raw = await run(store, a.headerHash, serving(a.identity));
    const zstd = await run(store, a.headerHash, serving(a.zstd));
    expect(manifestOf(zstd)).toBe(manifestOf(raw));
    expect(await store.list(`${FP}/payloads/`)).toHaveLength(1);
  });
});

describe("a copy that fails", () => {
  const altered = (() => {
    const bytes = Buffer.from(a.identity, "hex");
    bytes[bytes.length - 3] ^= 0xff;
    return bytes.toString("hex");
  })();

  const cases: Array<[string, () => Promise<string>, Partial<typeof LIMITS>]> = [
    ["another block's payload", async () => b.identity, {}],
    ["an altered byte", async () => altered, {}],
    ["a payload over the size limit", async () => a.zstd, { maxPayloadBytes: 64 }],
    [
      "a zstd payload that expands past its declared size",
      async () => {
        const inner = (await unwrapDaPayload(Buffer.from(a.identity, "hex"), LIMITS)).innerBytes;
        return encodeDaPayloadEnvelope({
          version: 1,
          contentEncoding: DaPayloadContentEncoding.zstd,
          innerBytes: 16,
          innerSha256: createHash("sha256").update(inner).digest(),
          body: zstdCompressSync(Buffer.from(inner)),
        }).toString("hex");
      },
      {},
    ],
  ];

  for (const [name, build, limits] of cases) {
    it(`is never published, and leaves a failure marker: ${name}`, async () => {
      const store = archive();
      const result = await run(store, a.headerHash, serving(await build()), {
        limits: { ...LIMITS, ...limits },
      });
      expect(result.state).toBe("failed");
      expect(await store.list(`${FP}/blocks/`)).toEqual([]);
      expect(await store.list(`${FP}/payloads/`)).toEqual([]);
      expect(await store.list(`${FP}/failures/`)).toEqual([`${FP}/failures/${a.headerHash}.json`]);
    });
  }
});

describe("a run that dies or cannot fetch", () => {
  it("leaves no manifest when it dies before writing one, and the next run completes the block", async () => {
    const store = archive();
    await expect(
      run(store, a.headerHash, serving(a.identity), {
        hooks: { beforeManifest: async () => { throw new Error("killed"); } },
      }),
    ).rejects.toThrow("killed");
    expect(await store.list(`${FP}/blocks/`)).toEqual([]);
    expect((await run(store, a.headerHash, serving(a.identity))).state).toBe("archived");
  });

  it("stops retrying a source after the capped number of attempts", async () => {
    const store = archive();
    const source = timingOut();
    const result = await run(store, a.headerHash, source, { retries: 2 });
    expect(result.state).toBe("failed");
    expect(source.calls).toBe(3);
  });
});

describe("a block that carries transactions", () => {
  /** A payload's `transactions` entries hold each transaction's Merkle root
   * value; its body is in `transaction_preimages`. The page must hold the
   * body, which is what every transaction view is decoded from. */
  it("pages each transaction's full body under its id, not its root value", async () => {
    const { chain } = JSON.parse(
      readFileSync(new URL("./fixtures/da-payloads-transactions.json", import.meta.url), "utf8"),
    ) as { chain: Array<Block & { txIds: string[]; labels: string[] }> };
    const corpus = JSON.parse(
      readFileSync(new URL("./fixtures/shape-corpus.json", import.meta.url), "utf8"),
    ) as { entries: Array<{ label: string; canonicalTxHex: string }> };
    const block = chain[1]!;
    const store = archive();
    const result = await run(store, block.headerHash, serving(block.identity));
    const manifest = JSON.parse(new TextDecoder().decode((await store.get(manifestOf(result)))!.bytes));
    expect(manifest.records.transactions).toEqual({ records: 2, pages: 1 });
    const pageKey = manifest.payloadKey.replace("/payloads/", "/blocks/").replace(/\.cbor$/, "-v1/transactions/0.json");
    const page = JSON.parse(new TextDecoder().decode((await store.get(pageKey))!.bytes));
    const bodies = Object.fromEntries(block.labels.map((l) => [l, corpus.entries.find((e) => e.label === l)!.canonicalTxHex]));
    expect(page.records.map((r: { value: string }) => r.value).sort()).toEqual(Object.values(bodies).sort());
    expect(page.records.map((r: { key: string }) => r.key).sort()).toEqual([...block.txIds].sort());
  });
});
