import { createHash } from "node:crypto";
import { createLedger, type Utxo } from "./ledger.mjs";
import { pick, rng, sampleCount } from "./random.mjs";
import { MAX_INLINE_CBOR_BYTES, type Profile } from "./profiles.mjs";
import {
  buildOversizeTx,
  loadCorpus,
  outrefOf,
  type CorpusParts,
  type ShapedTx,
} from "./shapeTx.mjs";

/**
 * The canonical dataset: one deterministic model that every artifact derives
 * from.
 *
 * Per ADR 0008 the fixture pipeline is a chain, not three generators, and this
 * is its first link. Rows here become the SQL seed, the seed feeds the real
 * routes, and the routes produce the snapshots. Nothing downstream invents a
 * value that did not come from here.
 *
 * The node's CHECK constraints are treated as part of the specification rather
 * than as something to discover at load time. `expected_total_event_count` must
 * equal the four event counts summed, `expected_transition_step_count` must
 * equal that total, roots must be 64 hex characters, header hashes 28 bytes,
 * and at most one row may be non-terminal.
 */

/** Fixed, so a dataset does not change because the day did. */
const EPOCH = Date.parse("2026-01-01T00:00:00.000Z");
/** One block every twenty seconds. Dense enough to page, spread enough to sort. */
const BLOCK_SPACING_MS = 20_000;

export type BlockCounts = {
  l2Transactions: number;
  deposits: number;
  withdrawals: number;
  forcedTransactions: number;
  totalEvents: number;
  transitionSteps: number;
};

export type GeneratedBlock = {
  height: number;
  headerHash: Buffer;
  baseTailHeaderHash: Buffer;
  status: string;
  blockStartTime: Date;
  blockEndTime: Date;
  headerCbor: Buffer;
  /** All twelve, base and expected. Every one 64 hex characters (I2). */
  roots: Record<string, string>;
  counts: BlockCounts;
  /** I6: true only where a real L1 header can settle it. */
  settled: boolean;
  transactions: readonly ShapedTx[];
};

export type Row = Record<string, unknown>;

export type Dataset = {
  profile: Profile;
  blocks: readonly GeneratedBlock[];
  tables: Record<string, Row[]>;
  /** The genesis size this dataset was built with, after calibration. */
  genesisUtxos: number;
};

/** The tables this generator fills, in foreign-key order for loading. */
/**
 * The tables this generator fills, in an order the foreign keys accept.
 *
 * The member tables reference the event tables, not the other way round:
 * `pending_block_finalization_deposits.member_id` references
 * `deposits_utxos.event_id`, and withdrawals do the same. So the event rows
 * must exist first. An earlier order put the members first and the load failed
 * on the first deposit.
 */
export const LOAD_ORDER = [
  "pending_block_finalizations",
  "deposits_utxos",
  "withdrawal_utxos",
  "forced_transaction_utxos",
  "pending_block_finalization_txs",
  "pending_block_finalization_deposits",
  "pending_block_finalization_withdrawals",
  "pending_block_finalization_forced_transactions",
  "pending_block_finalization_utxos",
  "pending_block_finalization_transition_trace",
  "pending_block_finalization_event_to_step",
  "da_payloads",
  "mempool_ledger",
  "confirmed_ledger",
  "immutable",
  "mempool",
  "processed_mempool",
  "blocks",
  "address_history",
  "tx_admissions",
  "tx_rejections",
  "mempool_tx_deltas",
] as const;

/** A deterministic 28-byte hash. Not a real header hash, and never claimed to be. */
const hash28 = (label: string): Buffer =>
  createHash("sha256").update(label).digest().subarray(0, 28);

/** A deterministic 32-byte hash. */
const hash32 = (label: string): Buffer =>
  createHash("sha256").update(label).digest();

/** A root: 32 bytes rendered as 64 lower-case hex, which is how the column stores it. */
const root = (label: string): string => hash32(label).toString("hex");

const ROOT_NAMES = [
  "base_utxos_root",
  "base_transactions_root",
  "base_deposits_root",
  "base_withdrawals_root",
  "base_forced_transactions_root",
  "expected_utxos_root",
  "expected_transactions_root",
  "expected_deposits_root",
  "expected_withdrawals_root",
  "expected_forced_transactions_root",
  "expected_transition_trace_root",
  "expected_event_to_step_root",
] as const;

export type GenerateOptions = {
  /**
   * Real L2 header hashes taken from the cloned L1 index, one per settled
   * block (I6). Omitted, the settled blocks carry derived hashes and the
   * cross-source assertion is a shape check rather than a real agreement.
   */
  settledHashes?: readonly Buffer[];
  parts?: CorpusParts;
};

/**
 * Generates a dataset, topping up the genesis pool if the live ledger would
 * fall short of the profile's floor.
 *
 * `ledgerUtxos` is a **floor, not a target**. The final unspent set is an
 * outcome of the block count and the input and output shapes, exactly as
 * transaction size is an outcome of the structure (I13). At `target` those
 * shapes produce about 30,000 live UTxOs from the smallest possible genesis,
 * so demanding exactly 25,000 would mean overriding the shapes that produced
 * it. What the floor exists for is the bound: the ledger must clear
 * `SCAN_LIMIT` or `asset-roster` measures the untruncated case.
 *
 * So calibration only ever raises. Deterministic: the same profile takes the
 * same number of passes and produces the same bytes.
 */
export function generateDataset(
  profile: Profile,
  options: GenerateOptions = {},
  forceGenesis?: number,
): Dataset {
  const parts = options.parts ?? loadCorpus();
  let genesis: number | undefined = forceGenesis;
  let dataset = buildDataset(profile, options, parts, genesis);
  for (let pass = 0; pass < (forceGenesis === undefined ? 3 : 0); pass += 1) {
    const achieved = dataset.tables.mempool_ledger.length;
    if (achieved >= profile.ledgerUtxos) break;
    genesis = (genesis ?? dataset.genesisUtxos) + (profile.ledgerUtxos - achieved);
    dataset = buildDataset(profile, options, parts, genesis);
  }
  return dataset;
}

function buildDataset(
  profile: Profile,
  options: GenerateOptions,
  parts: CorpusParts,
  genesisOverride: number | undefined,
): Dataset {
  const next = rng(profile.seed);

  // Draw the per-block event counts first, so the ledger can be sized to land
  // near `ledgerUtxos` once every transaction has run.
  const plan = Array.from({ length: profile.blocks }, () => {
    const u = next();
    const l2Transactions =
      u < profile.emptyBlockRate ? 0 : sampleCount(u, profile.txsPerBlock);
    return {
      l2Transactions,
      deposits: sampleCount(next(), profile.depositsPerBlock),
      withdrawals: sampleCount(next(), profile.withdrawalsPerBlock),
      forcedTransactions: sampleCount(next(), profile.forcedPerBlock),
      inputs: Math.max(1, sampleCount(next(), profile.inputsPerTx)),
      outputs: Math.max(1, sampleCount(next(), profile.outputsPerTx)),
    };
  });

  // Every transaction consumes `inputs` and produces `outputs`, so the ledger
  // grows by their difference. Sizing genesis by that difference is what makes
  // the final unspent set land on the profile's `ledgerUtxos` rather than
  // wherever the arithmetic happened to take it.
  const netGrowth = plan.reduce(
    (total, block) =>
      total + block.l2Transactions * (block.outputs - block.inputs),
    0,
  );
  const genesisUtxos =
    genesisOverride ??
    Math.max(Math.ceil(profile.ledgerUtxos * 0.05), profile.ledgerUtxos - netGrowth);

  const ledger = createLedger(parts, {
    seed: profile.seed + 1,
    addresses: profile.addresses,
    assets: profile.assets,
    genesisUtxos,
    genesisLovelace: 5_000_000_000n,
    addressSkew: profile.addressSkew,
    assetHolderSkew: profile.assetHolderSkew,
    assetsPerOutput: profile.assetsPerOutput,
    assetQuantity: profile.assetQuantity,
    datumRate: profile.datumRate,
    scriptRefRate: profile.scriptRefRate,
    redeemerRate: profile.redeemerRate,
  });

  const tables: Record<string, Row[]> = Object.fromEntries(
    LOAD_ORDER.map((name) => [name, [] as Row[]]),
  );

  // Status assignment. The schema permits at most one non-terminal row, so the
  // active one is the newest block and everything before it is terminal.
  const activeIndex =
    profile.statusMix.activeRows === 1 ? profile.blocks - 1 : -1;

  const blocks: GeneratedBlock[] = [];
  let time = EPOCH;
  let previousEnd = new Date(EPOCH);

  for (let height = 0; height < profile.blocks; height += 1) {
    const shape = plan[height];
    // I4: a share of blocks share the previous block's end time, which is what
    // makes the header-hash tiebreak observable.
    const collides =
      height > 0 && next() < profile.timestampCollisionRate;
    const blockStartTime = new Date(time);
    time += BLOCK_SPACING_MS;
    const blockEndTime = collides ? previousEnd : new Date(time);
    previousEnd = blockEndTime;

    const settled = height < profile.settledBlocks;
    const headerHash =
      settled && options.settledHashes?.[height]
        ? Buffer.from(options.settledHashes[height])
        : hash28(`block:${profile.name}:${height}`);

    const status =
      height === activeIndex
        ? (profile.statusMix.activeState as string)
        : pick(next(), [
            ["finalized", profile.statusMix.finalized],
            ["abandoned", profile.statusMix.abandoned],
          ]);

    // Transactions for this block, spent out of the live UTxO graph.
    const transactions: ShapedTx[] = [];
    const spentUtxos: Utxo[] = [];
    for (let i = 0; i < shape.l2Transactions; i += 1) {
      const step = ledger.spend({
        inputs: shape.inputs,
        outputs: shape.outputs,
      });
      if (!step) break;
      transactions.push(step.tx);
      spentUtxos.push(...step.spent);
    }

    const counts: BlockCounts = {
      l2Transactions: transactions.length,
      deposits: shape.deposits,
      withdrawals: shape.withdrawals,
      forcedTransactions: shape.forcedTransactions,
      totalEvents: 0,
      transitionSteps: 0,
    };
    counts.totalEvents =
      counts.withdrawals +
      counts.forcedTransactions +
      counts.l2Transactions +
      counts.deposits;
    counts.transitionSteps = counts.totalEvents;

    const roots = Object.fromEntries(
      ROOT_NAMES.map((name) => [name, root(`${name}:${profile.name}:${height}`)]),
    );
    const headerCbor = hash32(`header:${profile.name}:${height}`);
    const baseTailHeaderHash = hash28(`tail:${profile.name}:${height}`);

    const block: GeneratedBlock = {
      height,
      headerHash,
      baseTailHeaderHash,
      status,
      blockStartTime,
      blockEndTime,
      headerCbor,
      roots,
      counts,
      settled,
      transactions,
    };
    blocks.push(block);

    emitBlockRows(tables, block, profile, spentUtxos, next);
  }

  emitOversize(tables, parts, profile, blocks);

  // The confirmed ledger is the state at the last finalized block, so it is
  // snapshotted before the mempool spends run. `mempool_ledger` is that state
  // plus what the mempool has done to it, which is why the two differ.
  emitLedgerRows(tables, "confirmed_ledger", ledger.remaining());
  emitMempool(tables, ledger, profile, blocks);
  emitLedgerRows(tables, "mempool_ledger", ledger.remaining());
  return { profile, blocks, tables, genesisUtxos };
}

/** Every row a single block contributes, across the member and event tables. */
function emitBlockRows(
  tables: Record<string, Row[]>,
  block: GeneratedBlock,
  profile: Profile,
  spent: readonly Utxo[],
  next: () => number,
): void {
  const { headerHash, counts } = block;

  tables.pending_block_finalizations.push({
    header_hash: headerHash,
    submitted_tx_hash: hash32(`submitted:${block.height}`),
    block_end_time: block.blockEndTime,
    status: block.status,
    observed_confirmed_at_ms: block.blockEndTime.getTime(),
    // Excluded from coverage, and still NOT NULL without a default (I11). A
    // deterministic placeholder is correct here: nothing reads it, and its only
    // job is to satisfy the constraint.
    state_queue_lease_token: `lease-${block.height}`,
    base_snapshot_id: `snapshot-${block.height}`,
    base_tail_out_ref: `${hash32(`tail-ref:${block.height}`).toString("hex")}#0`,
    base_tail_header_hash: block.baseTailHeaderHash,
    base_tail_datum_cbor: hash32(`tail-datum:${block.height}`).toString("hex"),
    block_start_time: block.blockStartTime,
    header_cbor: block.headerCbor,
    // Explicit, not left to `DEFAULT now()`. A dataset carrying wall-clock
    // timestamps is not reproducible, so two loads of one profile would
    // checksum differently. It also makes ADR 0008's watermark testable: a
    // pass over this data has to produce the same result twice.
    created_at: block.blockStartTime,
    updated_at: block.blockEndTime,
    expected_withdrawal_count: BigInt(counts.withdrawals),
    expected_forced_transaction_count: BigInt(counts.forcedTransactions),
    expected_l2_transaction_count: BigInt(counts.l2Transactions),
    expected_deposit_count: BigInt(counts.deposits),
    expected_total_event_count: BigInt(counts.totalEvents),
    expected_transition_step_count: BigInt(counts.transitionSteps),
    ...block.roots,
  });

  tables.da_payloads.push({
    header_hash: headerHash,
    version: 2,
    payload_cbor: hash32(`da:${block.height}`),
    payload_sha256: hash32(`da-sha:${block.height}`),
    utxos_root: block.roots.expected_utxos_root,
    forced_transactions_root: block.roots.expected_forced_transactions_root,
    transactions_root: block.roots.expected_transactions_root,
    deposits_root: block.roots.expected_deposits_root,
    withdrawals_root: block.roots.expected_withdrawals_root,
    transition_trace_root: block.roots.expected_transition_trace_root,
    event_to_step_root: block.roots.expected_event_to_step_root,
    withdrawal_count: BigInt(counts.withdrawals),
    forced_transaction_count: BigInt(counts.forcedTransactions),
    l2_transaction_count: BigInt(counts.l2Transactions),
    deposit_count: BigInt(counts.deposits),
    total_event_count: BigInt(counts.totalEvents),
    transition_step_count: BigInt(counts.transitionSteps),
    block_start_time: block.blockStartTime,
    block_end_time: block.blockEndTime,
    created_at: block.blockStartTime,
    updated_at: block.blockEndTime,
  });

  block.transactions.forEach((tx, ordinal) => {
    const txId = Buffer.from(tx.txId);
    tables.pending_block_finalization_txs.push({
      header_hash: headerHash,
      member_id: txId,
      ordinal,
      payload_cbor: Buffer.from(tx.bytes),
      payload_sha256: createHash("sha256").update(tx.bytes).digest(),
      source_table: "immutable",
      source_id: txId,
      source_time_stamp_tz: block.blockEndTime,
    });
    tables.immutable.push({
      tx_id: txId,
      tx: Buffer.from(tx.bytes),
      time_stamp_tz: block.blockEndTime,
    });
    tables.blocks.push({
      header_hash: headerHash,
      tx_id: txId,
      time_stamp_tz: block.blockEndTime,
    });
    // One row per (tx, address) pair, not per output.
    // `address_history_tx_id_address_key` is unique, and a transaction paying
    // the same address twice is ordinary rather than exceptional.
    for (const address of new Set(tx.outputs.map((o) => o.address))) {
      tables.address_history.push({
        tx_id: txId,
        address,
        created_at: block.blockEndTime,
      });
    }
    emitAdmission(tables, txId, Buffer.from(tx.bytes), block, profile, next);
    tables.mempool_tx_deltas.push({
      tx_id: txId,
      spent_cbor: Buffer.from(tx.bytes).subarray(0, 64),
      produced_cbor: Buffer.from(tx.outputs[0]?.output ?? tx.bytes.subarray(0, 32)),
    });
  });

  emitEvents(tables, block, profile, next);
  emitTrace(tables, block);
  emitSpentUtxoMembers(tables, block, spent);
}

/** `tx_admissions`, honouring the two CHECK constraints on lease and terminal time. */
function emitAdmission(
  tables: Record<string, Row[]>,
  txId: Buffer,
  canonicalCbor: Buffer,
  block: GeneratedBlock,
  profile: Profile,
  next: () => number,
): void {
  const status = pick(next(), [
    ["queued", profile.admissionMix.queued],
    ["validating", profile.admissionMix.validating],
    ["accepted", profile.admissionMix.accepted],
    ["rejected", profile.admissionMix.rejected],
  ]);
  const terminal = status === "accepted" || status === "rejected";
  const validating = status === "validating";
  tables.tx_admissions.push({
    tx_id: txId,
    tx_canonical_cbor: canonicalCbor,
    tx_canonical_cbor_sha256: createHash("sha256").update(canonicalCbor).digest(),
    submit_source: "native",
    status,
    // check1: a lease exists on `validating` and nowhere else.
    lease_owner: validating ? `operator-${block.height % 4}` : null,
    lease_expires_at: validating
      ? new Date(block.blockEndTime.getTime() + 60_000)
      : null,
    // check2: `terminal_at` is set on the terminal states and nowhere else.
    terminal_at: terminal ? block.blockEndTime : null,
    // check3: a reject code exists only on `rejected`.
    reject_code: status === "rejected" ? "ScriptFailure" : null,
    reject_detail: status === "rejected" ? "generated dataset rejection" : null,
    first_seen_at: block.blockStartTime,
    last_seen_at: block.blockEndTime,
    arrival_seq: BigInt(tables.tx_admissions.length + 1),
    next_attempt_at: block.blockEndTime,
    updated_at: block.blockEndTime,
  });
  if (status === "rejected") {
    tables.tx_rejections.push({
      tx_id: txId,
      reject_code: "ScriptFailure",
      reject_detail: "generated dataset rejection",
      created_at: block.blockEndTime,
    });
  }
}

/** Deposits, withdrawals and forced transactions, and their member rows. */
function emitEvents(
  tables: Record<string, Row[]>,
  block: GeneratedBlock,
  profile: Profile,
  next: () => number,
): void {
  const { headerHash, counts } = block;
  const payload = (label: string) =>
    Buffer.concat([
      hash32(label),
      Buffer.alloc(
        Math.max(0, sampleCount(next(), profile.eventPayloadBytes) - 32),
        0x5a,
      ),
    ]);

  for (let i = 0; i < counts.deposits; i += 1) {
    const eventId = hash32(`deposit:${block.height}:${i}`);
    tables.deposits_utxos.push({
      event_id: eventId,
      event_info: payload(`deposit-info:${block.height}:${i}`),
      inclusion_time: block.blockEndTime,
      deposit_l1_tx_hash: hash32(`deposit-l1:${block.height}:${i}`),
      ledger_tx_id: hash32(`deposit-ledger:${block.height}:${i}`),
      ledger_output: hash32(`deposit-output:${block.height}:${i}`),
      ledger_address: `addr_test1deposit${block.height}x${i}`,
      projected_header_hash: headerHash,
      status: "projected",
    });
    tables.pending_block_finalization_deposits.push(
      memberRow(headerHash, eventId, i, "deposits_utxos", block.blockEndTime),
    );
  }

  for (let i = 0; i < counts.withdrawals; i += 1) {
    const eventId = hash32(`withdrawal:${block.height}:${i}`);
    tables.withdrawal_utxos.push({
      event_id: eventId,
      // `raw_event_info`, not `event_info`: withdrawals and deposits do not
      // share a column vocabulary, and the live p95 of 274 B is this column.
      raw_event_info: payload(`withdrawal-info:${block.height}:${i}`),
      inclusion_time: block.blockEndTime,
      withdrawal_l1_tx_hash: hash32(`withdrawal-l1:${block.height}:${i}`),
      withdrawal_l1_output_index: i,
      asset_name: Buffer.from(`withdraw${i}`).subarray(0, 32),
      l2_outref: hash32(`withdrawal-outref:${block.height}:${i}`),
      // 28, not 32: `withdrawal_utxos_l2_owner_check` requires a credential-
      // sized value here while its sibling hashes are 32 bytes.
      l2_owner: hash28(`withdrawal-owner:${block.height}:${i}`),
      l2_value: hash32(`withdrawal-value:${block.height}:${i}`),
      l1_address: hash32(`withdrawal-l1-addr:${block.height}:${i}`),
      l1_datum: hash32(`withdrawal-l1-datum:${block.height}:${i}`),
      refund_address: hash32(`withdrawal-refund:${block.height}:${i}`),
      refund_datum: hash32(`withdrawal-refund-datum:${block.height}:${i}`),
      // The check constraints require both of these whenever status is not
      // `awaiting`, so a `projected` row without them will not insert.
      settlement_event_info: payload(`withdrawal-settle:${block.height}:${i}`),
      // Withdrawals have their own validity vocabulary. `TxIsValid` belongs to
      // `forced_transaction_utxos.operator_validity` and is rejected here.
      validity: "WithdrawalIsValid",
      projected_header_hash: headerHash,
      status: "projected",
      created_at: block.blockStartTime,
      updated_at: block.blockEndTime,
    });
    tables.pending_block_finalization_withdrawals.push(
      memberRow(headerHash, eventId, i, "withdrawal_utxos", block.blockEndTime),
    );
  }

  for (let i = 0; i < counts.forcedTransactions; i += 1) {
    const orderId = hash32(`forced:${block.height}:${i}`);
    tables.forced_transaction_utxos.push({
      tx_order_id: orderId,
      tx_order_l1_tx_hash: hash32(`forced-l1:${block.height}:${i}`),
      tx_order_l1_output_index: i,
      asset_name: Buffer.from(`forced${i}`).subarray(0, 32),
      raw_datum: hash32(`forced-datum:${block.height}:${i}`),
      tx_id: hash32(`forced-tx:${block.height}:${i}`),
      tx_compact: hash32(`forced-compact:${block.height}:${i}`),
      forced_inclusion_value: hash32(`forced-value:${block.height}:${i}`),
      operator_validity: "TxIsValid",
      inclusion_time: block.blockEndTime,
      projected_header_hash: headerHash,
      status: "projected",
      created_at: block.blockStartTime,
      updated_at: block.blockEndTime,
    });
    tables.pending_block_finalization_forced_transactions.push(
      memberRow(
        headerHash,
        orderId,
        i,
        "forced_transaction_utxos",
        block.blockEndTime,
      ),
    );
  }
}

function memberRow(
  headerHash: Buffer,
  memberId: Buffer,
  ordinal: number,
  sourceTable: string,
  at: Date,
): Row {
  return {
    header_hash: headerHash,
    member_id: memberId,
    ordinal,
    payload_cbor: memberId,
    payload_sha256: createHash("sha256").update(memberId).digest(),
    source_table: sourceTable,
    source_id: memberId,
    source_time_stamp_tz: at,
  };
}

/** The transition trace and its event-to-step mapping, one row per event. */
function emitTrace(tables: Record<string, Row[]>, block: GeneratedBlock): void {
  // Both are member tables with the same eight columns as the others, not the
  // step/event index pair their names suggest.
  for (let step = 0; step < block.counts.transitionSteps; step += 1) {
    const traceId = hash32(`trace:${block.height}:${step}`);
    tables.pending_block_finalization_transition_trace.push(
      memberRow(block.headerHash, traceId, step, "transition_trace", block.blockEndTime),
    );
    const stepId = hash32(`event-step:${block.height}:${step}`);
    tables.pending_block_finalization_event_to_step.push(
      memberRow(block.headerHash, stepId, step, "event_to_step", block.blockEndTime),
    );
  }
}

/** The UTxO set this block consumed, recorded as finalization members. */
function emitSpentUtxoMembers(
  tables: Record<string, Row[]>,
  block: GeneratedBlock,
  spent: readonly Utxo[],
): void {
  // Four columns, not the eight the other member tables carry. This one keys
  // on `outref` and stores the `output` directly.
  spent.forEach((utxo, ordinal) => {
    tables.pending_block_finalization_utxos.push({
      header_hash: block.headerHash,
      outref: utxo.outref,
      ordinal,
      output: utxo.output,
    });
  });
}

/**
 * Transactions built to exceed `MAX_INLINE_CBOR_BYTES`.
 *
 * Kept out of the block loop because they are not a sample from any
 * distribution: they exist so `transaction-detail` measures the truncation
 * branch, which nothing else in the dataset reaches.
 */
function emitOversize(
  tables: Record<string, Row[]>,
  parts: CorpusParts,
  profile: Profile,
  blocks: readonly GeneratedBlock[],
): void {
  const host = blocks[blocks.length - 1];
  if (!host) return;
  for (let i = 0; i < profile.oversizeTransactions; i += 1) {
    const tx = buildOversizeTx(
      parts,
      MAX_INLINE_CBOR_BYTES,
      [outrefOf(hash32(`oversize-input:${i}`), i)],
      900_000_000_000n,
      200_000n,
      1_000_000 + i * 10_000,
    );
    tables.immutable.push({
      tx_id: Buffer.from(tx.txId),
      tx: Buffer.from(tx.bytes),
      time_stamp_tz: host.blockEndTime,
    });
  }
}

/**
 * Transactions that exist without a block: admitted to the mempool, and a
 * smaller set already processed but not finalized.
 *
 * Left empty these are a silent coverage gap. The mempool panel renders, shows
 * nothing, and its budget passes on an empty query.
 */
function emitMempool(
  tables: Record<string, Row[]>,
  ledger: ReturnType<typeof createLedger>,
  profile: Profile,
  blocks: readonly GeneratedBlock[],
): void {
  const at = blocks[blocks.length - 1]?.blockEndTime ?? new Date(EPOCH);
  const total = profile.mempoolTransactions + profile.processedMempoolTransactions;
  for (let i = 0; i < total; i += 1) {
    const step = ledger.spend({ inputs: 2, outputs: 2 });
    // `continue`, not `break`: one unfundable draw is not a reason to leave the
    // rest of the mempool empty.
    if (!step) continue;
    const table = i < profile.mempoolTransactions ? "mempool" : "processed_mempool";
    tables[table].push({
      tx_id: Buffer.from(step.tx.txId),
      tx: Buffer.from(step.tx.bytes),
      time_stamp_tz: at,
    });
  }
}

/** Whatever remains unspent is a ledger. Spent rows are gone, as upstream. */
function emitLedgerRows(
  tables: Record<string, Row[]>,
  table: "mempool_ledger" | "confirmed_ledger",
  remaining: readonly Utxo[],
): void {
  const withSource = table === "mempool_ledger";
  for (const utxo of remaining) {
    tables[table].push({
      tx_id: utxo.txId,
      outref: utxo.outref,
      output: utxo.output,
      address: utxo.address,
      // `confirmed_ledger` has no `source_event_id`; only the mempool ledger
      // tracks which deposit produced a row.
      ...(withSource ? { source_event_id: null } : {}),
      time_stamp_tz: new Date(EPOCH),
    });
  }
}
