/**
 * What Koios returns, and how to read it.
 *
 * Split out of `koios.ts`, which was carrying two jobs: describing the
 * provider's payloads, and talking to it over HTTP. They change for different
 * reasons. A schema moves when the provider's shape moves; the transport moves
 * when a timeout, a retry or a size limit needs tuning, and neither reader
 * should have to scroll past the other.
 *
 * Nothing here performs IO, so these parsers are testable against a JSON
 * literal without a network or a fake.
 *
 * `koios.ts` re-exports this module, so every existing import keeps working and
 * the split stays invisible to consumers.
 */
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
  (v) => {
    if (typeof v !== "string") return v;
    // A malformed string must fail as a normal ZodError at the array check
    // below, not escape .parse() as a raw SyntaxError that the rest of the
    // boundary validation doesn't produce.
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  },
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
  // No default: a script execution of unknown validity must fail parsing
  // loudly rather than being silently recorded as valid if Koios ever omits
  // this field. That is the exact failure mode this task exists to close.
  valid_contract: z.boolean(),
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

// Live-checked against preprod tx 9152dc88...ddf92: both sections were empty
// arrays on that transaction, so no populated example was available to shape
// these precisely. Typed as arrays of a permissive object rather than
// guessed-at fields, since we requested this data (_withdrawals, _certs) and
// it must survive parsing rather than being stripped by a bare z.object().
const withdrawalSchema = z.record(z.string(), z.unknown());
const certificateSchema = z.record(z.string(), z.unknown());

const txInfoSchema = z.object({
  tx_hash: z.string(),
  block_height: z.number(),
  block_hash: z.string(),
  absolute_slot: z.number(),
  epoch_no: z.number(),
  tx_timestamp: z.number(),
  // Outputs need the same detail as inputs/reference/collateral (tx_hash,
  // tx_index, datum_hash, asset_list, reference_script), so they use the
  // shared utxoSchema rather than the narrower txOutputSchema. Discovered
  // when writeTxDetail (Task 4) tried to read u.tx_hash off an output and
  // got undefined, because txOutputSchema stripped every field it didn't
  // declare.
  outputs: z.array(utxoSchema),
  fee: z.string(),
  tx_size: z.number(),
  total_output: z.string(),
  tx_block_index: z.number(),
  // No default: deposit is a base tx_info field present regardless of which
  // of the six detail flags are set, so a missing value means Koios' schema
  // changed, not that there is no deposit. Defaulting would mask that.
  deposit: z.string(),
  invalid_before: z.union([z.number(), z.string()]).nullable().default(null),
  invalid_after: z.union([z.number(), z.string()]).nullable().default(null),
  metadata: z.unknown().nullable().default(null),
  inputs: z.array(utxoSchema).default([]),
  reference_inputs: z.array(utxoSchema).default([]),
  collateral_inputs: z.array(utxoSchema).default([]),
  collateral_output: utxoSchema.nullable().default(null),
  assets_minted: z.array(assetSchema).default([]),
  plutus_contracts: z.array(plutusContractSchema).default([]),
  // No default, same reasoning as deposit: we requested this data via
  // _withdrawals/_certs, so its absence means something upstream changed,
  // not that the transaction has none (Koios still sends [] for "none").
  withdrawals: z.array(withdrawalSchema),
  certificates: z.array(certificateSchema),
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

/** One reward-account action. Koios nests the actions under the account they
 * belong to, so a flat list of transactions needs both levels. */
export const accountUpdateSchema = z.object({
  stake_address: z.string(),
  updates: z
    .array(
      z.object({
        tx_hash: z.string(),
        action_type: z.string(),
        block_time: z.number().nullable().default(null),
      }),
    )
    .default([]),
});

export type KoiosAccountUpdate = {
  stakeAddress: string;
  txHash: string;
  actionType: string;
};

/** The rows exactly as Koios counts them: one per account, each carrying its
 * own list of actions. Paging has to be decided on this count, not on the
 * flattened action count, or a page of 50 accounts holding 900 actions between
 * them reads as "more pages to come". */
export function parseAccountRows(json: unknown): z.infer<typeof accountUpdateSchema>[] {
  return z.array(accountUpdateSchema).parse(json);
}

export function parseAccountUpdates(json: unknown): KoiosAccountUpdate[] {
  return flattenAccountRows(parseAccountRows(json));
}

export function flattenAccountRows(
  rows: z.infer<typeof accountUpdateSchema>[],
): KoiosAccountUpdate[] {
  return rows.flatMap((account) =>
    account.updates.map((update) => ({
      stakeAddress: account.stake_address,
      txHash: update.tx_hash,
      actionType: update.action_type,
    })),
  );
}

export function parseTxInfo(json: unknown): KoiosTxInfo[] {
  return z.array(txInfoSchema).parse(json);
}

/** Koios is a shared public service. A request that hangs would stall the sync
 * tick behind it, and the tick is what keeps the index current. */
