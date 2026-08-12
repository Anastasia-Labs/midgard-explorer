import { Request, Response } from "express";
import { getSpendableLedger } from "../../db/asset";
import { getCodec } from "../../decode/codec";
import { isHexOfLength } from "../../utils";
import { cached } from "../cache";

/** Where a native asset currently sits, and the whole ledger's asset roster.
 *
 * Both routes decode UTxO values because Midgard keeps them inside canonical
 * CBOR, so neither can be answered in SQL alone. Two consequences are part of
 * the contract rather than caveats hidden in a comment:
 *
 *   - the answer describes the *current* ledger, not history. An asset minted
 *     and fully burned leaves nothing here, and saying so is the difference
 *     between "no holders" and "we did not look";
 *   - the scan is bounded, and the response reports what it covered so a
 *     partial answer can never be read as a complete one.
 */

type Holder = { address: string; quantity: string; utxoCount: number };

async function scanLedgerUncached() {
  const [{ rows, total, truncated }, codec] = await Promise.all([
    getSpendableLedger(),
    getCodec(),
  ]);
  let undecoded = 0;
  const decoded: Array<{
    address: string;
    lovelace: bigint;
    assets: ReadonlyMap<string, ReadonlyMap<string, bigint>>;
  }> = [];
  for (const row of rows) {
    try {
      const { value } = codec.decodeMidgardTxOutput(Buffer.from(row.output));
      decoded.push({ address: row.address, lovelace: value.lovelace, assets: value.assets });
    } catch {
      // One unreadable row degrades coverage; it must not fail the request.
      undecoded += 1;
    }
  }
  return {
    decoded,
    coverage: { scanned: rows.length, total, truncated, undecoded },
  };
}

/**
 * Held for ten seconds, shared by both routes on this file.
 *
 * The scan decodes up to 20,000 UTxOs from canonical CBOR per call, so an
 * uncached public route turned one request into that much work and let anyone
 * multiply it by their request rate. The snapshot is the whole ledger at one
 * moment, which is also the only self-consistent thing to serve: two routes
 * answering from different scans could disagree about the same asset.
 */
const scanLedger = cached("ledger-scan", 10_000, scanLedgerUncached);

export async function getAssetRoute(req: Request, res: Response) {
  const policyId = req.query.policy_id;
  const nameHex = req.query.asset_name ?? "";
  if (typeof policyId !== "string" || !isHexOfLength(policyId, 56)) {
    return res.status(400).json({ error: "Invalid policy_id." });
  }
  if (typeof nameHex !== "string" || !/^[0-9a-f]*$/i.test(nameHex) || nameHex.length % 2 !== 0) {
    return res.status(400).json({ error: "Invalid asset_name." });
  }
  const policy = policyId.toLowerCase();
  const name = nameHex.toLowerCase();

  const { decoded, coverage } = await scanLedger();

  const byAddress = new Map<string, { quantity: bigint; utxoCount: number }>();
  let totalQuantity = 0n;
  for (const row of decoded) {
    const quantity = row.assets.get(policy)?.get(name);
    if (quantity === undefined || quantity === 0n) continue;
    const entry = byAddress.get(row.address) ?? { quantity: 0n, utxoCount: 0 };
    entry.quantity += quantity;
    entry.utxoCount += 1;
    byAddress.set(row.address, entry);
    totalQuantity += quantity;
  }

  const holders: Holder[] = [...byAddress.entries()]
    .map(([address, v]) => ({
      address,
      quantity: v.quantity.toString(),
      utxoCount: v.utxoCount,
    }))
    // Largest first: the question a holder list answers is who holds most.
    .sort((a, b) => (BigInt(b.quantity) > BigInt(a.quantity) ? 1 : -1));

  return res.json({
    policyId: policy,
    assetName: name,
    /** Sum over the ledger rows scanned, which is a supply figure only when
     * coverage is complete. The client decides how to label it. */
    ledgerQuantity: totalQuantity.toString(),
    holderCount: holders.length,
    holders: holders.slice(0, 100),
    holdersTruncated: holders.length > 100,
    coverage,
  });
}

export async function getAssetsRoute(_req: Request, res: Response) {
  const { decoded, coverage } = await scanLedger();

  const roster = new Map<string, { quantity: bigint; holders: Set<string>; utxoCount: number }>();
  for (const row of decoded) {
    for (const [policyId, names] of row.assets) {
      for (const [assetName, quantity] of names) {
        if (quantity === 0n) continue;
        const key = `${policyId}:${assetName}`;
        const entry = roster.get(key) ?? {
          quantity: 0n,
          holders: new Set<string>(),
          utxoCount: 0,
        };
        entry.quantity += quantity;
        entry.holders.add(row.address);
        entry.utxoCount += 1;
        roster.set(key, entry);
      }
    }
  }

  const rows = [...roster.entries()]
    .map(([key, v]) => {
      const [policyId, assetName] = key.split(":");
      return {
        policyId: policyId!,
        assetName: assetName ?? "",
        ledgerQuantity: v.quantity.toString(),
        holderCount: v.holders.size,
        utxoCount: v.utxoCount,
      };
    })
    .sort((a, b) => b.holderCount - a.holderCount || b.utxoCount - a.utxoCount);

  return res.json({ rows, total: rows.length, coverage });
}
