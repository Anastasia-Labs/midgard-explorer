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

const txInfoSchema = z.object({
  tx_hash: z.string(),
  block_height: z.number(),
  block_hash: z.string(),
  absolute_slot: z.number(),
  epoch_no: z.number(),
  tx_timestamp: z.number(),
  outputs: z.array(txOutputSchema),
});

export type KoiosAddressTx = z.infer<typeof addressTxSchema>;
export type KoiosTxOutput = z.infer<typeof txOutputSchema>;
export type KoiosTxInfo = z.infer<typeof txInfoSchema>;

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

export async function fetchTxInfo(
  txHashes: string[],
): Promise<KoiosTxInfo[]> {
  if (txHashes.length === 0) return [];
  // `_scripts: true` is REQUIRED. Without it Koios returns every
  // `inline_datum.value` as null, the datum decoder finds nothing, and the
  // indexer silently records zero block headers while reporting success.
  return parseTxInfo(
    await post("/tx_info", { _tx_hashes: txHashes, _scripts: true }),
  );
}
