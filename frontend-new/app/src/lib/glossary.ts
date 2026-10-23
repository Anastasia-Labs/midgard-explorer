export type GlossaryEntry = {
  label: string;
  category: "Ledger" | "Transaction" | "Script" | "Asset" | "Explorer";
  meaning: string;
  consequence: string;
};

/** Shared explanations for protocol terms and unfamiliar semantic marks.
 *
 * Every entry answers two separate questions: what the item means, and what a
 * reader should infer or do because of it. Keeping those halves structured
 * prevents a terse label restatement from passing as help text.
 */
export const GLOSSARY = {
  chainTip: {
    label: "Chain tip",
    category: "Ledger",
    meaning: "The highest Midgard block currently known to this explorer.",
    consequence: "If its age keeps growing, block production or explorer ingestion may be stalled.",
  },
  blockThroughput: {
    label: "Block throughput",
    category: "Explorer",
    meaning: "The number of Midgard blocks produced in the stated observation window.",
    consequence: "A sustained zero means no block was produced in that window.",
  },
  transactionThroughput: {
    label: "Transaction throughput",
    category: "Explorer",
    meaning: "The number of Midgard transactions included during the stated observation window.",
    consequence: "Read it against the window and block count beside it.",
  },
  admissionLatency: {
    label: "Admission latency",
    category: "Explorer",
    meaning:
      "The measured time from first receipt until the node accepts or rejects a transaction.",
    consequence: "Rising percentiles mean the node is taking longer to decide.",
  },
  admissionQueue: {
    label: "Admission queue",
    category: "Explorer",
    meaning: "The number of received transactions still waiting for an admission decision.",
    consequence:
      "A growing queue indicates validation is arriving faster than the node can complete it.",
  },
  blockHeight: {
    label: "Block height",
    category: "Ledger",
    meaning: "The block's sequential position in the Midgard chain.",
    consequence: "A greater height is newer, but height alone does not prove Cardano finality.",
  },
  blockHash: {
    label: "Block hash",
    category: "Ledger",
    meaning: "The content-derived identifier for one exact block.",
    consequence:
      "Compare the full value when verifying a block because heights can be reorganized.",
  },
  slot: {
    label: "Slot",
    category: "Ledger",
    meaning: "The Cardano time slot in which the containing block was produced.",
    consequence: "Validity bounds expressed in slots decide whether a transaction can be accepted.",
  },
  epoch: {
    label: "Epoch",
    category: "Ledger",
    meaning: "A numbered Cardano period containing many slots.",
    consequence: "Protocol parameters and stake state can change at epoch boundaries.",
  },
  l1Finality: {
    label: "L1 settlement",
    category: "Ledger",
    meaning:
      "The Midgard block has been committed to Cardano and reached the required stability depth.",
    consequence:
      "Before settlement, its Midgard transactions remain reversible if the commitment is abandoned.",
  },
  transactionHash: {
    label: "Transaction hash",
    category: "Transaction",
    meaning: "The content-derived identifier of one exact transaction.",
    consequence: "Use the full hash, not its shortened display, when comparing or linking records.",
  },
  fee: {
    label: "Fee",
    category: "Transaction",
    meaning: "The lovelace paid for processing and storing this transaction.",
    consequence:
      "It is consumed rather than sent to an output, so inputs must cover outputs plus this amount.",
  },
  totalOutput: {
    label: "Total output",
    category: "Transaction",
    meaning: "The sum of lovelace assigned to every output in the transaction.",
    consequence: "It excludes the fee and does not describe native-asset quantities.",
  },
  validityInterval: {
    label: "Validity interval",
    category: "Transaction",
    meaning: "The inclusive slot range in which the ledger may accept the transaction.",
    consequence:
      "Outside that range the transaction is invalid even if its signatures and scripts pass.",
  },
  networkId: {
    label: "Network ID",
    category: "Transaction",
    meaning: "The Cardano network the transaction declares, such as mainnet or a testnet.",
    consequence:
      "A mismatched network prevents the transaction from being valid on the connected chain.",
  },
  transactionFormat: {
    label: "Format version",
    category: "Transaction",
    meaning: "The transaction-body encoding version decoded by the explorer.",
    consequence: "Unknown versions may leave otherwise valid bytes only partially decoded.",
  },
  witnessSet: {
    label: "Witness set",
    category: "Transaction",
    meaning: "The signatures, scripts, datums, and redeemers supplied to authorize a transaction.",
    consequence: "Missing or invalid required witnesses cause validation to fail.",
  },
  input: {
    label: "Input",
    category: "Transaction",
    meaning: "A previously created UTxO that this transaction consumes.",
    consequence: "After a valid transaction is applied, that exact UTxO cannot be spent again.",
  },
  output: {
    label: "Output",
    category: "Transaction",
    meaning: "A new UTxO created at an address with ada, assets, and optional script data.",
    consequence:
      "It remains spendable until another transaction consumes its transaction-hash and index pair.",
  },
  referenceInput: {
    label: "Reference input",
    category: "Transaction",
    meaning: "A UTxO made available to a script for reading without being spent.",
    consequence: "The referenced value stays in the ledger after this transaction succeeds.",
  },
  collateral: {
    label: "Collateral input",
    category: "Transaction",
    meaning: "A key-controlled input reserved to cover script-validation costs.",
    consequence: "It can be collected when phase-two script validation fails.",
  },
  collateralReturn: {
    label: "Collateral return",
    category: "Transaction",
    meaning: "The output returning collateral value not required by the transaction.",
    consequence:
      "When present, only the declared total collateral is at risk rather than the whole collateral input.",
  },
  metadata: {
    label: "Transaction metadata",
    category: "Transaction",
    meaning: "Auxiliary label-keyed data attached to the transaction but not held in a UTxO.",
    consequence:
      "Applications may interpret it, but spending rules do not treat it as ledger state.",
  },
  cip20Message: {
    label: "CIP-20 message",
    category: "Transaction",
    meaning: "Human-readable message fragments stored under transaction metadata label 674.",
    consequence:
      "The text is user-supplied and should not be treated as verified identity or protocol instruction.",
  },
  certificateDeposit: {
    label: "Certificate deposit",
    category: "Transaction",
    meaning: "Lovelace deposited or refunded by stake, pool, DRep, or governance certificates.",
    consequence: "It changes the transaction balance independently of ordinary UTxO outputs.",
  },
  paymentCredential: {
    label: "Payment credential",
    category: "Ledger",
    meaning: "The key hash or script hash that authorizes spending from an address.",
    consequence:
      "A script credential requires successful script execution; a key credential requires its signature.",
  },
  stakeCredential: {
    label: "Stake credential",
    category: "Ledger",
    meaning: "The key or script identity controlling staking rights associated with an address.",
    consequence:
      "It determines delegation and reward authority, not who can spend the payment value.",
  },
  consumedBy: {
    label: "Consumed by",
    category: "Ledger",
    meaning: "The later transaction that spent this exact UTxO.",
    consequence:
      "A consumed output is historical and no longer contributes to the current ledger balance.",
  },
  stateCommitment: {
    label: "State commitment",
    category: "Ledger",
    meaning:
      "The Midgard block header written into a Cardano transaction, holding the Merkle roots for that block's transactions, deposits, withdrawals, forced transactions and state transition.",
    consequence:
      "It is what Cardano actually records about a Midgard block. The block's contents are not on Cardano, so this is the durable evidence a block was committed, not a copy of what it contained.",
  },
  merkleRoot: {
    label: "Merkle root",
    category: "Ledger",
    meaning:
      "A single hash summarising a whole set of items, so any one item can be proven a member of the set without publishing the rest.",
    consequence:
      "A matching root proves the set has not changed since it was committed. It does not by itself reveal or retrieve any item in that set.",
  },
  settlementTransaction: {
    label: "Settlement transaction",
    category: "Ledger",
    meaning: "The Cardano transaction that carried this state commitment onto the L1 chain.",
    consequence:
      "Until a commitment is attributed to one, the explorer has seen the header re-output by a later transaction but has not yet observed the transaction that first committed it.",
  },
  datumHash: {
    label: "Datum hash",
    category: "Script",
    meaning: "The hash committing an output to the datum a spending script expects.",
    consequence: "The actual datum must match this hash when the output is spent.",
  },
  inlineDatum: {
    label: "Inline datum",
    category: "Script",
    meaning: "Script state stored directly inside an output instead of only by hash.",
    consequence:
      "A spender can read it without supplying separate datum bytes, but still must satisfy the script.",
  },
  referenceScript: {
    label: "Reference script",
    category: "Script",
    meaning: "Reusable script bytes stored on an output and referenced by another transaction.",
    consequence:
      "The spending transaction can avoid carrying those bytes again, reducing its size and fee.",
  },
  scriptBytes: {
    label: "Script bytes",
    category: "Script",
    meaning: "The serialized on-ledger program that participates in transaction validation.",
    consequence:
      "Recompute and compare its hash before treating the displayed script identity as verified.",
  },
  redeemer: {
    label: "Redeemer",
    category: "Script",
    meaning: "The transaction-supplied argument and purpose for one Plutus script execution.",
    consequence:
      "Its value and indexed purpose influence whether that script accepts the transaction.",
  },
  executionUnits: {
    label: "Execution units",
    category: "Script",
    meaning: "The measured Plutus memory and CPU-step budgets used by a script execution.",
    consequence:
      "Exceeding either declared limit makes validation fail and affects the execution fee.",
  },
  scriptSize: {
    label: "Script size",
    category: "Script",
    meaning: "The number of bytes in the serialized script.",
    consequence:
      "Larger scripts increase transaction size when carried directly and can increase fees.",
  },
  protocolEvent: {
    label: "Protocol event",
    category: "Script",
    meaning: "A Midgard action classified from an authoritative validator output and its datum.",
    consequence: "An event the explorer cannot classify is still shown, with its raw datum.",
  },
  mintBurn: {
    label: "Mint / burn",
    category: "Asset",
    meaning: "A signed change to a native asset's total supply under its policy.",
    consequence:
      "Positive quantities create units and negative quantities permanently remove units.",
  },
  policyId: {
    label: "Policy ID",
    category: "Asset",
    meaning: "The hash identifying the minting policy that controls an asset.",
    consequence: "Assets with the same display name but different policy IDs are unrelated.",
  },
  assetName: {
    label: "Asset name",
    category: "Asset",
    meaning: "Up to 32 user-chosen bytes paired with a policy ID.",
    consequence:
      "Decoded text is untrusted and non-unique, so compare the canonical bytes or fingerprint.",
  },
  assetFingerprint: {
    label: "Asset fingerprint",
    category: "Asset",
    meaning: "A CIP-14 checksum derived from the policy ID and asset-name bytes.",
    consequence:
      "It provides a shorter identity to compare without trusting the asset's display name.",
  },
  rawData: {
    label: "Raw data",
    category: "Explorer",
    meaning:
      "The schema-validated response returned by the explorer API without presentation changes.",
    consequence: "Use it to check a value on this page against its source.",
  },
  apiRequest: {
    label: "API request",
    category: "Explorer",
    meaning: "The public HTTP request the explorer used to load this record.",
    consequence: "Reuse it to fetch the same record yourself. It returns schema-validated JSON.",
  },
  cbor: {
    label: "CBOR",
    category: "Explorer",
    meaning: "The canonical binary encoding used for Cardano transaction and script data.",
    consequence:
      "Raw bytes remain the record of truth when a decoder cannot interpret a newer shape.",
  },
  partialDecode: {
    label: "Partial decode",
    category: "Explorer",
    meaning: "The explorer received the record but could not interpret every encoded field.",
    consequence:
      "Visible decoded values remain usable, while missing values must not be assumed to be zero or absent.",
  },
  addressMark: {
    label: "Address mark",
    category: "Explorer",
    meaning: "A deterministic visual mark generated from the full address.",
    consequence: "It helps spot a repeated address at a glance. Compare the text to be certain.",
  },
  scriptMark: {
    label: "Script credential mark",
    category: "Explorer",
    meaning:
      "A square credential mark denotes a script-controlled address rather than a key-controlled one.",
    consequence: "Spending from it requires the script conditions, not only a wallet signature.",
  },
  assetMark: {
    label: "Asset mark",
    category: "Explorer",
    meaning: "A deterministic circular mark generated from an asset's policy and name bytes.",
    consequence:
      "It helps distinguish nearby rows. It is generated from the bytes, not supplied by the issuer.",
  },
  statusMarker: {
    label: "Status marker",
    category: "Explorer",
    meaning: "The shape beside a status label carries the same distinction its color does.",
    consequence: "Four shapes: progress, waiting, success, and failure.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTerm = keyof typeof GLOSSARY;

export const glossaryText = (term: GlossaryTerm): string => {
  const entry = GLOSSARY[term];
  return `${entry.meaning} ${entry.consequence}`;
};
