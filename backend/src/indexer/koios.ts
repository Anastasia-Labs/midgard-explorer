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
const accountUpdateSchema = z.object({
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
function parseAccountRows(json: unknown): z.infer<typeof accountUpdateSchema>[] {
  return z.array(accountUpdateSchema).parse(json);
}

export function parseAccountUpdates(json: unknown): KoiosAccountUpdate[] {
  return flattenAccountRows(parseAccountRows(json));
}

function flattenAccountRows(
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
const REQUEST_TIMEOUT_MS = 30_000;

/** Above this a response is not a transaction list, it is a problem. Reading
 * it into memory on a 2 core box with 1GB free is how the process dies.
 *
 * Measured on the decoded body rather than content-length: Koios gzips and
 * chunks its responses, so that header is usually absent and a guard reading it
 * would report success while protecting nothing. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** Rate limiting and 5xx are both worth retrying, and both are worse if every
 * client retries immediately. Three attempts at 1s, 2s, 4s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exported so the threshold can be tested without allocating a 32MB string on
 * a box with a gigabyte free, which is the machine this guard protects. */
export const isOverSizeLimit = (
  byteLength: number,
  limit: number = MAX_RESPONSE_BYTES,
): boolean => byteLength > limit;

async function sendOnce(path: string, body: unknown): Promise<Response> {
  // `body === undefined` is the GET case rather than a POST with no payload:
  // Koios reads parameters from the query string for the endpoints that take
  // them that way, and sending a body would change the endpoint, not the shape.
  const init: RequestInit =
    body === undefined
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        };
  return fetch(`${config.KOIOS_BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Retryable: the service is busy or briefly broken, not the request is wrong.
 * A 400 retried three times is three wrong answers instead of one. */
const isRetryable = (status: number) => status === 429 || status >= 500;

/** Same retry, size bound and error reporting as `post`, without a body. */
async function get(path: string): Promise<unknown> {
  return send(path, undefined);
}

async function post(path: string, body: unknown): Promise<unknown> {
  return send(path, body);
}

async function send(path: string, body: unknown): Promise<unknown> {
  let res: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      res = await sendOnce(path, body);
      if (!isRetryable(res.status)) break;
      lastError = new Error(`Koios ${path} responded ${res.status}`);
    } catch (err) {
      // A timeout or a dropped connection. Same treatment as a 503.
      res = null;
      lastError = err;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await sleep(delay);
  }

  if (!res) {
    throw new Error(`Koios ${path} failed after retries: ${String(lastError)}`);
  }

  if (!res.ok) {
    // Koios puts the actual reason (rate limit, malformed request) in the body.
    // Dropping it makes production failures far harder to read from logs.
    const body = await res.text().catch(() => "");
    throw new Error(
      `Koios ${path} responded ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  return JSON.parse(await readBounded(res, MAX_RESPONSE_BYTES, path));
}

/**
 * Reads a body and gives up the moment it grows past `limit`, cancelling the
 * rest.
 *
 * Measuring after `res.text()` returns cannot bound anything: the string is
 * already allocated by the time its length is known, which is the outcome the
 * limit exists to prevent. The size is measured on the decoded bytes as they
 * arrive rather than on content-length, because Koios gzips and chunks, so that
 * header is usually absent and a guard reading it would report success while
 * protecting nothing.
 */
export async function readBounded(
  res: Response,
  limit: number,
  path: string,
): Promise<string> {
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (isOverSizeLimit(bytes, limit)) {
      await reader.cancel();
      throw new Error(
        `Koios ${path} returned over the ${limit} byte limit; stopped reading`,
      );
    }
    out += decoder.decode(value, { stream: true });
  }

  return out + decoder.decode();
}

/**
 * Koios caps any response at 1000 rows and answers a request for more without
 * saying it truncated. A single unpaged request is therefore indistinguishable
 * from a complete answer, and the caller that advanced a cursor over it skipped
 * whatever did not fit, permanently.
 *
 * Verified against preprod on 2026-08-27: `?offset=0&limit=2` and
 * `?offset=2&limit=2` return different rows on `/address_txs`, and an offset
 * past the end returns an empty array, which is the loop's exit condition.
 */
/**
 * Ascending order, stated rather than inherited.
 *
 * Offset pagination is only stable if the ordering is both deterministic and
 * append-only at the end. Koios answers `/address_txs` newest-first by default,
 * so a transaction confirmed between two page requests takes offset 0 and
 * shifts every later page down by one: one row is returned twice and one is
 * never seen at all, and the cursor then advances past the row that was
 * skipped. Ascending by height puts new rows after everything already read, so
 * the pages behind the reader do not move. `tx_hash` breaks ties within a
 * block, because height alone does not define a total order.
 */
const ORDER_BY_HEIGHT = "block_height.asc,tx_hash.asc";

const KOIOS_PAGE_SIZE = 1000;

/**
 * Requests bigger than this are split. Koios documents a small request payload
 * limit, and an unbounded `_addresses` or `_tx_hashes` array grows with the
 * deployment until a request that used to work starts failing.
 */
const KOIOS_BATCH_SIZE = 50;

/** A scan that pages forever is a scan that never returns. Reaching this means
 * the exit condition is wrong, not that the chain is large: at this page size
 * it is a million rows for one address set. */
const MAX_PAGES = 1_000;

export function chunk<T>(items: T[], size: number = KOIOS_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every page of one query. A page shorter than the page size is the last one,
 * which is the only signal Koios gives that a result set is complete. */
async function postAllPages<T>(
  path: string,
  body: unknown,
  parse: (json: unknown) => T[],
  order: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const query =
      `${path}${sep}offset=${page * KOIOS_PAGE_SIZE}` +
      `&limit=${KOIOS_PAGE_SIZE}&order=${order}`;
    const rows = parse(await post(query, body));
    out.push(...rows);
    if (rows.length < KOIOS_PAGE_SIZE) return out;
  }
  throw new Error(
    `Koios ${path} did not terminate within ${MAX_PAGES} pages of ` +
      `${KOIOS_PAGE_SIZE}; refusing to treat the result as complete`,
  );
}

export async function fetchAddressTxs(
  addresses: string[],
  afterBlockHeight: number,
): Promise<KoiosAddressTx[]> {
  if (addresses.length === 0) return [];
  const out: KoiosAddressTx[] = [];
  for (const batch of chunk(addresses)) {
    out.push(
      ...(await postAllPages(
        "/address_txs",
        { _addresses: batch, _after_block_height: afterBlockHeight },
        parseAddressTxs,
        ORDER_BY_HEIGHT,
      )),
    );
  }
  return out;
}

/**
 * Reward-account history for script stake credentials.
 *
 * A validator whose only handler is `withdraw` is executed by a zero-value
 * withdrawal. That execution is recorded against the reward address derived
 * from the script hash and never touches the enterprise payment address, so no
 * amount of address scanning can see it. Verified on preprod 2026-08-27: the
 * `phasMembership` reward account is registered and its registration
 * transaction was absent from the index.
 */
export async function fetchAccountUpdates(
  stakeAddresses: string[],
): Promise<KoiosAccountUpdate[]> {
  if (stakeAddresses.length === 0) return [];
  const rows: z.infer<typeof accountUpdateSchema>[] = [];
  for (const batch of chunk(stakeAddresses)) {
    rows.push(
      ...(await postAllPages(
        "/account_updates",
        { _stake_addresses: batch },
        parseAccountRows,
        // One row per account, not per update, so the account is the key.
        "stake_address.asc",
      )),
    );
  }
  return flattenAccountRows(rows);
}

/**
 * Detail for every requested transaction, or an error naming what is missing.
 *
 * The caller deletes a reconciliation window and rewrites it from this result,
 * then advances its cursor. A short answer accepted as complete therefore
 * destroys history rather than merely omitting it, so an incomplete response
 * has to stop the pass rather than shrink it.
 */
export async function fetchTxInfo(txHashes: string[]): Promise<KoiosTxInfo[]> {
  if (txHashes.length === 0) return [];
  const out: KoiosTxInfo[] = [];
  for (const batch of chunk(txHashes)) {
    out.push(...(await fetchTxInfoBatch(batch)));
  }
  const returned = new Set(out.map((info) => info.tx_hash));
  const missing = txHashes.filter((hash) => !returned.has(hash));
  if (missing.length > 0) {
    throw new Error(
      `Koios /tx_info returned ${returned.size} of ${txHashes.length} ` +
        `requested transactions. Missing: ${missing.slice(0, 5).join(", ")}` +
        `${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`,
    );
  }
  return out;
}

async function fetchTxInfoBatch(txHashes: string[]): Promise<KoiosTxInfo[]> {
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
      // Same trap, different section: without this every inline_datum.bytes
      // comes back null while inline_datum.value is populated, so anything
      // decoding from authoritative CBOR has nothing to read and cannot tell
      // that apart from a UTxO with no datum. Measured on preprod 2026-08-07:
      // bytes length 0 without the flag, 50/746/806 with it.
      _bytecode: true,
    }),
  );
}

const policyAssetSchema = z.object({
  asset_name: z.string().nullable().default(null),
});

/** Assets minted under one policy. Used to find Midgard transactions that
 * carry no output at a Midgard script address, which address scanning alone
 * cannot see. */
export async function fetchPolicyAssets(policyId: string): Promise<string[]> {
  const rows = await postAllPages(
    "/policy_asset_list",
    { _asset_policy: policyId },
    (json) => z.array(policyAssetSchema).parse(json),
    "asset_name.asc",
  );
  return rows.map((r) => r.asset_name ?? "");
}

/** Every transaction that ever held one asset. `_history: true` is required:
 * without it Koios returns only the transaction holding the asset RIGHT NOW,
 * so a deployment transaction whose token has since moved would be invisible. */
export async function fetchAssetTxs(
  policyId: string,
  assetName: string,
  afterBlockHeight: number = 0,
): Promise<KoiosAddressTx[]> {
  return postAllPages(
    "/asset_txs",
    {
      _asset_policy: policyId,
      _asset_name: assetName,
      _after_block_height: afterBlockHeight,
      _history: true,
    },
    parseAddressTxs,
    ORDER_BY_HEIGHT,
  );
}

const epochParamsSchema = z.object({
  epoch_no: z.number(),
  // Koios sends these as JSON numbers. Both are within Number's exact integer
  // range today (1.75e7 and 1e10), but they cross into the database as BigInt
  // because a limit is a ledger quantity and every other one here already does.
  max_tx_ex_mem: z.number(),
  max_tx_ex_steps: z.number(),
});

export type KoiosEpochParams = {
  epochNo: number;
  maxTxExMem: bigint;
  maxTxExSteps: bigint;
};

/** Protocol parameters for one epoch, or the current one when none is named.
 *
 * Only the two execution limits are lifted out. They are what the explorer
 * renders a script's budget against, and a limit that is compiled in rather
 * than read is wrong from the first governance action that changes it, without
 * anything on the page saying so. These do change: preprod epoch 301 allowed
 * 16,500,000 memory units per transaction and epoch 307 allowed 17,500,000.
 *
 * Koios returns epochs newest first, so `limit=1` is the current one. */
export async function fetchEpochParams(epochNo?: number): Promise<KoiosEpochParams | null> {
  const query = epochNo === undefined ? "limit=1" : `_epoch_no=${epochNo}`;
  const rows = z.array(epochParamsSchema).parse(await get(`/epoch_params?${query}`));
  const row = rows[0];
  if (!row) return null;
  return {
    epochNo: row.epoch_no,
    maxTxExMem: BigInt(row.max_tx_ex_mem),
    maxTxExSteps: BigInt(row.max_tx_ex_steps),
  };
}
