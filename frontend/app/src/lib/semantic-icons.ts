import type { IconName } from "../components/ui/base/icons";
import type { GlossaryTerm } from "./glossary";

export const SEMANTIC_ICONS = {
  utxo: { icon: "utxo", term: "output" },
  input: { icon: "arrowDownToLine", term: "input" },
  output: { icon: "arrowUpFromLine", term: "output" },
  referenceInput: { icon: "eye", term: "referenceInput" },
  datum: { icon: "datum", term: "inlineDatum" },
  datumHash: { icon: "datum", term: "datumHash" },
  script: { icon: "script", term: "scriptBytes" },
  collateral: { icon: "shield", term: "collateral" },
  mintBurn: { icon: "mintBurn", term: "mintBurn" },
  metadata: { icon: "metadata", term: "metadata" },
  certificate: { icon: "metadata", term: "certificateDeposit" },
  withdrawal: { icon: "arrowUpFromLine", term: "stakeCredential" },
  governance: { icon: "layers", term: "protocolEvent" },
  consumedBy: { icon: "consumedBy", term: "consumedBy" },
  paymentCredential: { icon: "key", term: "paymentCredential" },
  stakeCredential: { icon: "stake", term: "stakeCredential" },
  requiredSigner: { icon: "key", term: "paymentCredential" },
  requiredObserver: { icon: "eye", term: "stakeCredential" },
  protocolEvent: { icon: "activity", term: "protocolEvent" },
  executionTrace: { icon: "route", term: "executionUnits" },
  rawData: { icon: "hash", term: "rawData" },
  cbor: { icon: "hash", term: "cbor" },
  api: { icon: "activity", term: "apiRequest" },
} as const satisfies Record<string, { icon: IconName; term: GlossaryTerm }>;

export type SemanticIconKind = keyof typeof SEMANTIC_ICONS;
