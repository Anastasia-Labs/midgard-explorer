#!/usr/bin/env node
/**
 * Writes test/fixtures/da-payloads-transactions.json: linked blocks whose DA
 * payloads carry real Midgard native transactions, for exercising the
 * archive's pages end to end. `chain` is three blocks from genesis, `fork` a
 * second child of genesis re-carrying the first block's transaction, `paged`
 * a fourth block of 60 payments (two pages), and `empty` two empty blocks.
 *
 *   node scripts/generate-da-fixtures.mjs
 *
 * Built only with the vendored Midgard packages: the transactions are the
 * shape corpus's canonical native CBOR, their root values come from
 * fault-proofs' encodeTransactionRootValue, the payload from the SDK's
 * encodeDaPayload, the header hash from hashBlockHeader, and the envelope
 * from core's wrapDaPayload. The base header is a buildPayloadFixture header
 * from da-payloads-f4cf28ca1.json with its links, counts and times replaced.
 *
 * Its Merkle roots are the base header's, not recomputed over these bodies:
 * header binding verifies, a commitment check would not. Deterministic: the
 * same inputs give the same bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import * as sdk from "@al-ft/midgard-sdk";
import { encodeTransactionRootValue } from "@al-ft/midgard-fault-proofs/block-replay";
import {
  cardanoTxBytesToMidgardNativeTxCanonicalCbor,
  computeMidgardNativeTxId,
  decodeMidgardNativeTxFullFromCanonicalCbor,
} from "@al-ft/midgard-core";
import { Emulator, Lucid, walletFromSeed } from "@lucid-evolution/lucid";
import { unwrapDaPayload, wrapDaPayload } from "@al-ft/midgard-core/da-payload-envelope";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "..", "test", "fixtures");
const corpus = JSON.parse(fs.readFileSync(path.join(fixtures, "shape-corpus.json"), "utf8"));
const base = JSON.parse(fs.readFileSync(path.join(fixtures, "da-payloads-f4cf28ca1.json"), "utf8")).withTransaction[0];

const LIMITS = { maxPayloadBytes: 64 * 1024 * 1024 };
const baseInner = Buffer.from((await unwrapDaPayload(Buffer.from(base.identity, "hex"), LIMITS)).innerBytes);
const basePayload = sdk.decodeDaPayload(baseInner);

const native = (cbor) => {
  const id = computeMidgardNativeTxId(decodeMidgardNativeTxFullFromCanonicalCbor(cbor)).toString("hex");
  return { id, cbor, root: encodeTransactionRootValue(cbor) };
};
const tx = (label) => native(Buffer.from(corpus.entries.find((e) => e.label === label).canonicalTxHex, "hex"));

const sorted = (entries) => [...entries].sort((a, b) => a[0].localeCompare(b[0]));

const START = Date.parse("2026-10-19T08:00:00.000Z");
const LAYOUT = [["multi-output"], ["inline-datum", "mint-multiasset"], ["multi-input", "script-ref", "burn"]];

const GENESIS = "00".repeat(28);
const build = async (prev, labels, i, prepared = labels.map(tx), start = START) => {
  const txs = prepared;
  const n = BigInt(txs.length);
  const header = {
    ...basePayload.block_body.header,
    prevHeaderHash: prev,
    l2TransactionCount: n,
    totalEventCount: n,
    startTime: BigInt(start + i * 20_000),
    endTime: BigInt(start + i * 20_000 + 19_000),
  };
  const headerHash = await Effect.runPromise(sdk.hashBlockHeader(header));
  const payload = {
    ...basePayload,
    block_body: {
      ...basePayload.block_body,
      header_hash: headerHash,
      header,
      counts: { ...basePayload.block_body.counts, l2TransactionCount: n, totalEventCount: n },
      transactions: sorted(txs.map((t) => [t.id, t.root.toString("hex")])),
      transaction_preimages: sorted(txs.map((t) => [t.id, t.cbor.toString("hex")])),
    },
  };
  const inner = sdk.encodeDaPayload(payload);
  const identity = (await wrapDaPayload(inner, { mode: "identity" })).toString("hex");
  return { headerHash, prevHeaderHash: prev, labels, txIds: txs.map((t) => t.id), identity };
};

const blocks = [];
let prev = GENESIS;
for (const [i, labels] of LAYOUT.entries()) {
  const block = await build(prev, labels, i);
  blocks.push(block);
  prev = block.headerHash;
}
// A second child of genesis carrying the first block's transaction: two
// archived blocks with one transaction, and a branch no rollback is inferred from.
const fork = await build(GENESIS, LAYOUT[0], LAYOUT.length);

// More transactions than one archive page holds (50), so the block's
// transactions span two pages. Real signed payments from a Lucid emulator
// wallet on a public test mnemonic, so every run builds the same ones.
const SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const wallet = walletFromSeed(SEED, { network: "Custom" });
const emulator = new Emulator([{ seedPhrase: SEED, address: wallet.address, assets: { lovelace: 100_000_000_000n }, privateKey: "" }]);
const lucid = await Lucid(emulator, "Custom");
lucid.selectWallet.fromSeed(SEED);
const PAYMENTS = 60;
const payments = [];
for (let i = 0; i < PAYMENTS; i += 1) {
  const built = await lucid.newTx().pay.ToAddress(wallet.address, { lovelace: 1_000_000n + BigInt(i) }).complete();
  const signed = await built.sign.withWallet().complete();
  await signed.submit();
  emulator.awaitBlock(1);
  payments.push(native(Buffer.from(cardanoTxBytesToMidgardNativeTxCanonicalCbor(Buffer.from(signed.toCBOR(), "hex")))));
}
const paged = await build(blocks.at(-1).headerHash, [`${PAYMENTS} payments`], LAYOUT.length + 1, payments);

// Two empty blocks an hour earlier, for a header the archive knows of but has
// not fetched: archive the second with a one-block bound and the first awaits.
const EMPTY_START = START - 60 * 60_000;
const e1 = await build(GENESIS, [], 0, [], EMPTY_START);
const e2 = await build(e1.headerHash, [], 1, [], EMPTY_START);

const out = {
  _provenance:
    "Generated by `node scripts/generate-da-fixtures.mjs` from shape-corpus.json and a buildPayloadFixture base header (f4cf28ca1, preprod-testing), with the vendored SDK, core and fault-proofs encoders. Roots are the base header's: header binding verifies, commitment does not. Fixture data, not a live capture.",
  chain: blocks,
  fork,
  sharedTxId: fork.txIds[0],
  paged,
  empty: [e1, e2],
};
fs.writeFileSync(path.join(fixtures, "da-payloads-transactions.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log([...blocks, fork, paged, e1, e2].map((b) => `${b.headerHash} ${b.labels.join(",")}`).join("\n"));
