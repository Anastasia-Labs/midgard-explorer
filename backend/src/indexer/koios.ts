import { z } from "zod";
import { config } from "../config";

// Koios returns JSON we do not control, so every response is validated at the
// boundary rather than cast. A shape change upstream should fail loudly here,
// not surface as an undefined three layers away.

const addressTxSchema = z.object({
  tx_hash: z.string(),
  epoch_no: z.number(),
  block_height: z.number(),
  block_time: z.number(),
});

const txOutputSchema = z.object({
  payment_addr: z.object({ bech32: z.string() }),
  value: z.string(),
  inline_datum: z.object({ value: z.unknown() }).nullable().default(null),
});

const assetSchema = z.object({
  policy_id: z.string(),
  asset_name: z.string().nullable().default(null),
  fingerprint: z.string().nullable().default(null),
  quantity: z.string(),
  decimals: z.number().nullable().default(null),
});

// Koios' collateral_output has been observed returning asset_list as the
// JSON-encoded string "[]" instead of an actual array (live-checked against
// preprod tx 9152dc88...ddf92), while every other utxo's asset_list is a real
// array. This preprocess accepts either without changing the inferred type.
const assetListSchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.array(assetSchema).default([]),
);

const utxoSchema = z.object({
  payment_addr: z.object({ bech32: z.string(), cred: z.string() }).nullable().default(null),
  stake_addr: z.string().nullable().default(null),
  tx_hash: z.string(),
  tx_index: z.number(),
  value: z.string(),
  datum_hash: z.string().nullable().default(null),
  // bytes is observed null (not merely absent) on live responses, so it must
  // accept both nullable and optional rather than optional alone.
  inline_datum: z.object({ bytes: z.string().nullable().optional(), value: z.unknown().optional() })
    .nullable().default(null),
  reference_script: z.object({
    hash: z.string(), size: z.number().nullable().default(null),
    type: z.string().nullable().default(null), bytes: z.string().nullable().optional(),
  }).nullable().default(null),
  asset_list: assetListSchema,
});

const plutusContractSchema = z.object({
  address: z.string().nullable().default(null),
  script_hash: z.string(),
  size: z.number().nullable().default(null),
  valid_contract: z.boolean().default(true),
  // Live-checked against preprod tx 9152dc88...ddf92: spends_input is the
  // UTxO the script spends ({ tx_hash, tx_index }), not a boolean.
  spends_input: z.object({ tx_hash: z.string(), tx_index: z.number() }).nullable().default(null),
  input: z.object({
    redeemer: z.object({
      purpose: z.string(),
      fee: z.string(),
      unit: z.object({ mem: z.string(), steps: z.string() }),
      datum: z.object({ hash: z.string().nullable().default(null), value: z.unknown() })
        .nullable().default(null),
    }),
  }).nullable().default(null),
});

const txInfoSchema = z.object({
  tx_hash: z.string(),
  block_height: z.number(),
  block_hash: z.string(),
  absolute_slot: z.number(),
  epoch_no: z.number(),
  tx_timestamp: z.number(),
  outputs: z.array(txOutputSchema),
  fee: z.string(),
  tx_size: z.number(),
  total_output: z.string(),
  tx_block_index: z.number(),
  deposit: z.string().default("0"),
  invalid_before: z.union([z.number(), z.string()]).nullable().default(null),
  invalid_after: z.union([z.number(), z.string()]).nullable().default(null),
  metadata: z.unknown().nullable().default(null),
  inputs: z.array(utxoSchema).default([]),
  reference_inputs: z.array(utxoSchema).default([]),
  collateral_inputs: z.array(utxoSchema).default([]),
  collateral_output: utxoSchema.nullable().default(null),
  assets_minted: z.array(assetSchema).default([]),
  plutus_contracts: z.array(plutusContractSchema).default([]),
});

export type KoiosAddressTx = z.infer<typeof addressTxSchema>;
export type KoiosTxOutput = z.infer<typeof txOutputSchema>;
export type KoiosTxInfo = z.infer<typeof txInfoSchema>;
export type KoiosAsset = z.infer<typeof assetSchema>;
export type KoiosUtxo = z.infer<typeof utxoSchema>;
export type KoiosPlutusContract = z.infer<typeof plutusContractSchema>;

export function parseAddressTxs(json: unknown): KoiosAddressTx[] {
  return z.array(addressTxSchema).parse(json);
}

export function parseTxInfo(json: unknown): KoiosTxInfo[] {
  return z.array(txInfoSchema).parse(json);
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${config.KOIOS_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Koios puts the actual reason (rate limit, malformed request) in the body.
    // Dropping it makes production failures far harder to read from logs.
    const body = await res.text().catch(() => "");
    throw new Error(
      `Koios ${path} responded ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }
  return res.json();
}

export async function fetchAddressTxs(
  addresses: string[],
  afterBlockHeight: number,
): Promise<KoiosAddressTx[]> {
  if (addresses.length === 0) return [];
  return parseAddressTxs(
    await post("/address_txs", {
      _addresses: addresses,
      _after_block_height: afterBlockHeight,
    }),
  );
}

export async function fetchTxInfo(txHashes: string[]): Promise<KoiosTxInfo[]> {
  if (txHashes.length === 0) return [];
  // Every one of these flags is load-bearing. Koios does not error on a
  // missing flag, it returns that section as an empty array, which is
  // indistinguishable from a transaction that genuinely has none. Measured on
  // preprod tx 9152dc88...ddf92: dropping _inputs turns 3 inputs into 0.
  return parseTxInfo(
    await post("/tx_info", {
      _tx_hashes: txHashes,
      _scripts: true,
      _inputs: true,
      _assets: true,
      _metadata: true,
      _withdrawals: true,
      _certs: true,
    }),
  );
}
