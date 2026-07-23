/**
 * Dev-only generator for the encoding-shape corpus.
 *
 * Builds Conway transactions of the shapes the live node has never produced
 * (mint, multi-asset, inline datum, script reference, multi-input/output,
 * burn) on a Lucid Evolution emulator, converts each to Midgard-native
 * canonical CBOR with the same vendored codec the backend decodes with, and
 * pins the results in test/fixtures/shape-corpus.json.
 *
 * These are codec-compatibility fixtures, not live-ingestion evidence: they
 * prove the explorer's decoder handles the shapes, not that the node has
 * committed them. Lucid is pinned to 0.4.31, the same version the vendored
 * @al-ft/midgard-core depends on.
 *
 * Run from backend/: node scripts/generate-shape-fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Data,
  Emulator,
  Lucid,
  fromText,
  generateEmulatorAccount,
  mintingPolicyToId,
  paymentCredentialOf,
  scriptFromNative,
} from "@lucid-evolution/lucid";
import { cardanoTxBytesToMidgardNativeTxCanonicalCbor } from "@al-ft/midgard-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, "../test/fixtures/shape-corpus.json");

const alice = generateEmulatorAccount({ lovelace: 100_000_000_000n });
const bob = generateEmulatorAccount({ lovelace: 100_000_000_000n });
const emulator = new Emulator([alice, bob]);
const lucid = await Lucid(emulator, "Custom");
lucid.selectWallet.fromSeed(alice.seedPhrase);

const aliceKeyHash = paymentCredentialOf(alice.address).hash;
const policy = scriptFromNative({ type: "sig", keyHash: aliceKeyHash });
const policyId = mintingPolicyToId(policy);
const assetName = fromText("SHAPE");
const unit = policyId + assetName;

const entries = [];

async function capture(label, description, tx, expectations) {
  const completed = await tx.complete();
  const signed = await completed.sign.withWallet().complete();
  const conwayTxHex =
    typeof signed.toCBOR === "function" ? signed.toCBOR() : signed.toString();
  const lucidTxHash = await signed.submit();
  emulator.awaitBlock(1);
  const canonical = cardanoTxBytesToMidgardNativeTxCanonicalCbor(
    Buffer.from(conwayTxHex, "hex"),
  );
  entries.push({
    label,
    description,
    lucidTxHash,
    conwayTxHex,
    canonicalTxHex: Buffer.from(canonical).toString("hex"),
    expectations,
  });
  console.log(`captured ${label} (${conwayTxHex.length / 2} bytes conway)`);
}

// 1. Mint + multi-asset output.
await capture(
  "mint-multiasset",
  "Mints 1000 SHAPE under a sig native script and pays 600 to another address",
  lucid
    .newTx()
    .mintAssets({ [unit]: 1000n })
    .attach.MintingPolicy(policy)
    .pay.ToAddress(bob.address, { lovelace: 5_000_000n, [unit]: 600n }),
  {
    mintPolicyIds: [policyId],
    assetOutputs: [{ policyId, assetName, quantity: "600" }],
    hasDatumCount: 0,
    hasScriptRefCount: 0,
    minOutputs: 2,
  },
);

// 2. Inline datum on a multi-asset output (no mint).
await capture(
  "inline-datum",
  "Pays 100 SHAPE with an inline integer datum; mint field stays null",
  lucid.newTx().pay.ToAddressWithData(
    bob.address,
    { kind: "inline", value: Data.to(42n) },
    { lovelace: 3_000_000n, [unit]: 100n },
  ),
  {
    mintIsNull: true,
    assetOutputs: [{ policyId, assetName, quantity: "100" }],
    hasDatumCount: 1,
    hasScriptRefCount: 0,
  },
);

// 3. Script-reference output (with a datum so the output carries both flags).
await capture(
  "script-ref",
  "Pays an output carrying both an inline datum and a native-script reference",
  lucid.newTx().pay.ToAddressWithData(
    bob.address,
    { kind: "inline", value: Data.to(1n) },
    { lovelace: 4_000_000n },
    policy,
  ),
  {
    hasDatumCount: 1,
    hasScriptRefCount: 1,
  },
);

// 4. Multi-output: two self-payments (feeds the multi-input case) plus one payment out.
await capture(
  "multi-output",
  "Three explicit outputs plus change",
  lucid
    .newTx()
    .pay.ToAddress(alice.address, { lovelace: 5_000_000n })
    .pay.ToAddress(alice.address, { lovelace: 5_000_000n })
    .pay.ToAddress(bob.address, { lovelace: 2_000_000n }),
  {
    minOutputs: 4,
  },
);

// 5. Multi-input: explicitly collect the two 5 ADA self-outputs made above.
const aliceUtxos = await lucid.utxosAt(alice.address);
const fiveAdaUtxos = aliceUtxos
  .filter((u) => u.assets.lovelace === 5_000_000n && !u.scriptRef)
  .slice(0, 2);
if (fiveAdaUtxos.length !== 2) {
  throw new Error(`expected two 5 ADA inputs, found ${fiveAdaUtxos.length}`);
}
await capture(
  "multi-input",
  "Explicitly spends two inputs into one payment",
  lucid
    .newTx()
    .collectFrom(fiveAdaUtxos)
    .pay.ToAddress(bob.address, { lovelace: 8_000_000n }),
  {
    minInputs: 2,
  },
);

// 6. Burn.
await capture(
  "burn",
  "Burns 200 SHAPE; mint field present with a negative quantity",
  lucid
    .newTx()
    .mintAssets({ [unit]: -200n })
    .attach.MintingPolicy(policy),
  {
    mintPolicyIds: [policyId],
  },
);

const fixture = {
  _provenance:
    "Generated by scripts/generate-shape-fixtures.mjs on a Lucid Evolution 0.4.31 emulator; Conway txs converted with the vendored @al-ft/midgard-core cardanoTxBytesToMidgardNativeTxCanonicalCbor. Codec-compatibility fixtures, not live-node captures.",
  generatedAtIso: new Date().toISOString(),
  network: "Custom",
  policyId,
  assetName,
  entries,
};

fs.writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${entries.length} entries to ${outPath}`);
