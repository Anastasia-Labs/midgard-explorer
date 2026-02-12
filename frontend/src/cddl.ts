export type Hash28 = Uint8Array | string;
export type Hash32 = Uint8Array | string;
export type Address = Uint8Array;
export type Coin = number | bigint;
export type UInt = number;

export type TransactionId = Hash32;
export type OutputReference = [TransactionId, UInt];
export type TransactionInput = OutputReference;

export type PolicyId = Hash28;
export type AssetName = Uint8Array | string;
export type Multiasset<T> = Record<string, Record<string, T>>;

export type Value = Coin | [Coin, Multiasset<Coin>];

export type PlutusData = unknown;
export type Data = PlutusData;
export type ScriptRef = Uint8Array | string;

export type TransactionOutput = {
  0: Address;
  1: Value;
  2?: Data;
  3?: ScriptRef;
};

export type Mint = Multiasset<Coin>;

export type RequiredSigners = Hash28[];
export type RequiredObservers = Hash28[];
export type AuxiliaryDataHash = Hash32;
export type ScriptDataHash = Hash32;

export type TransactionBody = {
  0: TransactionInput[];
  1: TransactionOutput[];
  2: Coin;
  3?: UInt;
  7?: AuxiliaryDataHash;
  8?: UInt;
  9?: Mint;
  11?: ScriptDataHash;
  14?: RequiredSigners;
  15?: UInt;
  18?: TransactionInput[];
  23?: RequiredObservers;
};

export type VKeyWitness = {
  0: Uint8Array | string; // vkey
  1: Uint8Array | string; // signature
};

export type NativeScript = unknown;
export type Redeemers = unknown;
export type PlutusV3Script = Uint8Array | string;

export type TransactionWitnessSet = {
  0?: VKeyWitness[];
  1?: NativeScript[];
  5?: Redeemers;
  7?: PlutusV3Script[];
};

export type AuxiliaryData = null;

export type Transaction = [
  TransactionBody,
  TransactionWitnessSet,
  boolean,
  AuxiliaryData | null,
];
