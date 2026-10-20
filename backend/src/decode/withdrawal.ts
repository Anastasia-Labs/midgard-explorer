// Narrow Lucid imports avoid loading unused wallet and provider modules.
import { type Credential, type Network } from "@lucid-evolution/core-types";
import { credentialToAddress } from "@lucid-evolution/utils";
import { decodeDatumResult } from "./datum";
import type { AssetMap, ValueView } from "./types";

type Sdk = typeof import("@al-ft/midgard-sdk", { with: { "resolution-mode": "import" } });

/**
 * The SDK the node writes these columns with: `Data.to(value, SDK.Value)` and
 * `Data.to(address, SDK.AddressData)`. Read back with the same schemas rather
 * than copies of them, which had already drifted: the SDK writes a pointer
 * stake credential flat, and the copy still expected it wrapped in a tuple.
 *
 * Loaded synchronously because the route maps rows synchronously. Node 24
 * loads the package's ESM build with `require`.
 */
const sdk = (): Sdk =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@al-ft/midgard-sdk") as Sdk;

type WithdrawalAddress = import("@al-ft/midgard-sdk", { with: { "resolution-mode": "import" } }).AddressData;
type WithdrawalCredential = WithdrawalAddress["paymentCredential"];
type WithdrawalValue = Map<string, Map<string, bigint>>;

export type FieldDecode<T> =
  { value: T; error: null } | { value: null; error: string };

export function decodeWithdrawalValue(
  bytes: Uint8Array,
): FieldDecode<ValueView> {
  const result = decodeDatumResult<WithdrawalValue>(
    Buffer.from(bytes).toString("hex"),
    sdk().ValueSchema,
  );
  if (!result.ok) {
    return {
      value: null,
      error: "Failed to decode l2_value as Midgard SDK Plutus data.",
    };
  }

  let lovelace = 0n;
  const assets: AssetMap = {};
  for (const [policyId, names] of result.value.entries()) {
    for (const [assetName, quantity] of names.entries()) {
      if (policyId === "" && assetName === "") {
        lovelace += quantity;
        continue;
      }
      const policy = assets[policyId] ?? {};
      policy[assetName] = (policy[assetName] ?? 0n) + quantity;
      assets[policyId] = policy;
    }
  }
  return { value: { lovelace, assets }, error: null };
}

const credential = (value: WithdrawalCredential): Credential =>
  "PublicKeyCredential" in value
    ? { type: "Key", hash: value.PublicKeyCredential[0] }
    : { type: "Script", hash: value.ScriptCredential[0] };

export function decodeWithdrawalAddress(
  bytes: Uint8Array,
  network: "preprod" | "mainnet",
): FieldDecode<string> {
  const result = decodeDatumResult<WithdrawalAddress>(
    Buffer.from(bytes).toString("hex"),
    sdk().AddressSchema,
  );
  if (!result.ok) {
    return {
      value: null,
      error: "Failed to decode l1_address as Midgard SDK Plutus data.",
    };
  }

  try {
    const decoded = result.value;
    if (
      decoded.stakeCredential !== null &&
      "Pointer" in decoded.stakeCredential
    ) {
      return {
        value: null,
        error: "Pointer stake credentials are not supported.",
      };
    }
    const stake =
      decoded.stakeCredential === null
        ? undefined
        : credential(decoded.stakeCredential.Inline[0]);
    return {
      value: credentialToAddress(
        (network === "mainnet" ? "Mainnet" : "Preprod") as Network,
        credential(decoded.paymentCredential),
        stake,
      ),
      error: null,
    };
  } catch {
    return {
      value: null,
      error: "Failed to decode l1_address as Midgard SDK Plutus data.",
    };
  }
}
