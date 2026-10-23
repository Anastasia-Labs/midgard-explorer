import {
  Data,
  credentialToAddress,
  type Credential,
  type Network,
} from "@lucid-evolution/lucid";
import { decodeDatumResult } from "./datum";
import type { AssetMap, ValueView } from "./types";

/** Kept structurally identical to midgard-sdk/src/common.ts. The node writes
 * these columns with Data.to(value, SDK.Value/SDK.AddressData). */
export const WithdrawalValueSchema = Data.Map(
  Data.Bytes(),
  Data.Map(Data.Bytes(), Data.Integer()),
);

const Hash28 = Data.Bytes({ minLength: 28, maxLength: 28 });
export const WithdrawalCredentialSchema = Data.Enum([
  Data.Object({ PublicKeyCredential: Data.Tuple([Hash28]) }),
  Data.Object({ ScriptCredential: Data.Tuple([Hash28]) }),
]);
export const WithdrawalAddressSchema = Data.Object({
  paymentCredential: WithdrawalCredentialSchema,
  stakeCredential: Data.Nullable(
    Data.Enum([
      Data.Object({ Inline: Data.Tuple([WithdrawalCredentialSchema]) }),
      Data.Object({
        Pointer: Data.Tuple([
          Data.Object({
            slotNumber: Data.Integer(),
            transactionIndex: Data.Integer(),
            certificateIndex: Data.Integer(),
          }),
        ]),
      }),
    ]),
  ),
});

type WithdrawalCredential = Data.Static<typeof WithdrawalCredentialSchema>;
type WithdrawalAddress = Data.Static<typeof WithdrawalAddressSchema>;
type WithdrawalValue = Map<string, Map<string, bigint>>;

export type FieldDecode<T> =
  { value: T; error: null } | { value: null; error: string };

export function decodeWithdrawalValue(
  bytes: Uint8Array,
): FieldDecode<ValueView> {
  const result = decodeDatumResult<WithdrawalValue>(
    Buffer.from(bytes).toString("hex"),
    WithdrawalValueSchema,
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
    WithdrawalAddressSchema,
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
