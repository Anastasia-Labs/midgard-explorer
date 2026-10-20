/**
 * The operator's verdict on a forced transaction, read from
 * `forced_transaction_utxos.forced_inclusion_value`.
 *
 * Midgard dropped the `operator_validity` column: the verdict is now part of
 * the `ForcedInclusionTxV1` the node encodes into that value, so it is read
 * back with the SDK's own schema rather than a decoder of ours.
 */
type Sdk = typeof import("@al-ft/midgard-sdk", { with: { "resolution-mode": "import" } });
type Lucid = typeof import("@lucid-evolution/lucid", { with: { "resolution-mode": "import" } });

let modules: Promise<[Sdk, Lucid]> | null = null;
const load = (): Promise<[Sdk, Lucid]> =>
  (modules ??= Promise.all([
    import("@al-ft/midgard-sdk") as Promise<Sdk>,
    import("@lucid-evolution/lucid") as Promise<Lucid>,
  ]));

export type ForcedVerdict = {
  verdict: "ForcedTxValid" | "ForcedTxInvalid";
  /** The rejection reason's constructor name for an invalid verdict. */
  reason: string | null;
};

/** The verdict, or null when the value does not decode as a `ForcedInclusionTxV1`. */
export async function decodeForcedVerdict(value: Uint8Array): Promise<ForcedVerdict | null> {
  const [sdk, { Data }] = await load();
  let decoded: import("@al-ft/midgard-sdk", { with: { "resolution-mode": "import" } }).ForcedInclusionTxV1;
  try {
    decoded = Data.from(Buffer.from(value).toString("hex"), sdk.ForcedInclusionTxV1);
  } catch {
    return null;
  }
  const { verdict } = decoded;
  if (verdict === "ForcedTxValid") return { verdict, reason: null };
  return { verdict: "ForcedTxInvalid", reason: sdk.rejectionReasonArmOf(verdict.ForcedTxInvalid.reason) };
}
