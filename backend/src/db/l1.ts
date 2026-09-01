import { config } from "../config";
import { prisma } from "../db";
import {
  SYNC_SOURCES,
  classifySyncCursors,
  getSyncCursor,
  getSyncCursors,
  indexerPrisma,
} from "../indexer/db";
import { loadManifest } from "../indexer/manifest";
import {
  decodeDepositDatum,
  decodeSchedulerDatum,
  decodeWithdrawalDatum,
} from "../indexer/userEventDatum";
import { decodeSchedulerRedeemer } from "../decode/schedulerRedeemer";
import { logger } from "../logger";

const PAGE_SIZE = 25;

/** Whether the contract governing a family actually validated.
 *
 * Deposits, withdrawals and block commitments used to report `true` with
 * nothing behind it: the value was a literal in the row builder, not a reading
 * of anything. Paying to a script address runs no script, so most of those
 * transactions carry no redeemer for that family and there is no verdict to
 * report. Null says exactly that, and is not the same answer as success.
 *
 * A family with several redeemers passes only if every one of them passed: a
 * transaction is valid or it is not, and one failing script fails the phase.
 */
export function contractVerdict(
  redeemers: ReadonlyArray<{ scriptHash: string; validContract: boolean }>,
  familyOf: (scriptHash: string) => string | undefined,
  family: string,
): boolean | null {
  const rows = redeemers.filter((row) => familyOf(row.scriptHash) === family);
  if (rows.length === 0) return null;
  return rows.every((row) => row.validContract);
}

export async function getL1TransactionsPage(
  page: number,
  pageSize = PAGE_SIZE,
) {
  const current = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const skip = (current - 1) * pageSize;

  const [rows, total] = await Promise.all([
    indexerPrisma.l1Tx.findMany({
      // txTime comes from the Cardano block, so every transaction in the same
      // block ties. Without a deterministic tiebreaker, OFFSET/LIMIT can
      // repeat or drop rows across pages once the table exceeds one page.
      orderBy: [{ txTime: "desc" }, { txHash: "desc" }],
      skip,
      take: pageSize,
      include: { events: true },
    }),
    indexerPrisma.l1Tx.count(),
  ]);

  return {
    rows,
    total,
    hasNextPage: skip + rows.length < total,
    limit: pageSize,
  };
}

/**
 * One transaction with every section the indexer stored. Grouped here rather
 * than in the route so the shape is testable without HTTP.
 *
 * Until now this returned the transaction and its Midgard events only, so every
 * input, output, asset and redeemer the indexer writes was unreachable. The
 * sections are split by `kind` rather than returned as one flat list, because a
 * caller that has to filter by kind is a caller that can get the filter wrong.
 */
export async function getL1Transaction(txHash: string) {
  const [tx, committedHeaders, spenders] = await Promise.all([
    indexerPrisma.l1Tx.findUnique({
      where: { txHash },
      include: {
        events: true,
        redeemers: true,
        // Native assets belong to the UTxO they were found in, so they are
        // nested. Mints belong to no UTxO and would be lost by that join, so
        // they come from the ioId-less rows instead.
        ios: {
          include: { assets: true },
          orderBy: [{ kind: "asc" }, { position: "asc" }],
        },
        assets: { where: { ioId: null } },
      },
    }),
    indexerPrisma.l1BlockHeader.findMany({
      where: { l1TxHash: txHash },
      select: { headerHash: true },
      orderBy: { headerHash: "asc" },
    }),
    // Which indexed transaction spent each output this one produced. The index
    // holds Midgard-related transactions only, so the absence of a row means no
    // indexed transaction consumed that output. It does not mean unspent, and
    // the response must not be read as saying so.
    indexerPrisma.l1TxIo.findMany({
      where: { kind: "input", sourceTxHash: txHash },
      select: { sourceIndex: true, txHash: true },
    }),
  ]);
  if (!tx) return null;

  // The transaction's OWN epoch, not the current one. Execution limits are
  // governance-changeable, so measuring a two-year-old transaction against
  // today's parameters would restate history. Null when that epoch was never
  // recorded, which the response says plainly rather than substituting the
  // nearest epoch we happen to hold.
  const protocolParams = await indexerPrisma.l1ProtocolParams.findUnique({
    where: { epochNo: tx.epoch },
    select: { epochNo: true, maxTxExMem: true, maxTxExSteps: true },
  });

  const { ios, assets, ...rest } = tx;
  const of = (kind: string) => ios.filter((io) => io.kind === kind);

  // Only a UTxO this transaction produced can carry a spender. An input's
  // consumer is this transaction itself, so answering the question there would
  // restate the row it is printed on.
  const spentByIndex = new Map(spenders.map((row) => [row.sourceIndex, row.txHash]));
  const produced = <T extends { sourceIndex: number }>(io: T) => ({
    ...io,
    spentBy: spentByIndex.get(io.sourceIndex) ?? null,
  });

  // Deposit and header events remain useful even if deployment identity is
  // temporarily unavailable. Only redeemer-to-family attribution depends on
  // the manifest, so degrade that part instead of failing the whole record.
  let familyByScript = new Map<string, string>();
  try {
    const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);
    familyByScript = new Map(
      manifest.validators.map((validator) => [validator.scriptHash, validator.family]),
    );
  } catch (error) {
    logger.warn(`Could not attribute L1 redeemers to Midgard validators: ${String(error)}`);
  }
  const actionFamilies = new Set<string>();
  const actions: Array<{
    kind: "deposit" | "withdrawal" | "block_commitment" | "scheduler_shift" | "validator_execution";
    family: string;
    outputIndex: number | null;
    lovelace: bigint | null;
    operation: string | null;
    validContract: boolean | null;
    operator: string | null;
    startTime: bigint | null;
    /* What the scheduler passed over when it skipped an operator. "none" is a
     * decoded answer; null means this action cannot neglect anything. */
    neglected: "none" | "deposit" | "withdrawal" | "txOrder" | null;
    /* Who the user event names, from its own datum. Re-decoded from the stored
     * datum rather than read from the stored decode, so a row indexed before
     * the decoder existed answers too. Amounts stay out of here: a deposit's
     * value is the event UTxO's value, which is already `lovelace`, and a
     * withdrawal's l2_value is not one of the fields the decoder extracts. */
    userEvent:
      | {
          kind: "deposit";
          l2PaymentCredential: string;
          l2StakeCredential: string | null;
          l2NetworkId: number;
          inclusionTime: bigint;
        }
      | {
          kind: "withdrawal";
          l2Owner: string;
          l2OutRef: { txHash: string; index: number };
          inclusionTime: bigint;
        }
      | null;
    headerHash: string | null;
  }> = [];

  const contractValidity = (family: string): boolean | null =>
    contractVerdict(tx.redeemers, (hash) => familyByScript.get(hash), family);

  for (const event of tx.events) {
    if (event.eventType === "blockCommitment") {
      if (!actions.some((action) => action.kind === "block_commitment")) {
        actions.push({
          kind: "block_commitment",
          family: event.validator,
          outputIndex: event.outputIndex,
          lovelace: null,
          operation: null,
          validContract: contractValidity(event.validator),
          operator: null,
          startTime: null,
          neglected: null,
          userEvent: null,
          headerHash: committedHeaders[0]?.headerHash ?? null,
        });
      }
      actionFamilies.add(event.validator);
      continue;
    }
    if (event.eventType === "deposit" || event.eventType === "withdrawal") {
      const deposit = event.eventType === "deposit" ? decodeDepositDatum(event.datum) : null;
      const withdrawal =
        event.eventType === "withdrawal" ? decodeWithdrawalDatum(event.datum) : null;
      actions.push({
        kind: event.eventType,
        family: event.validator,
        outputIndex: event.outputIndex,
        lovelace: event.eventType === "deposit" ? event.lovelace : null,
        operation: null,
        validContract: contractValidity(event.validator),
        operator: null,
        startTime: null,
        neglected: null,
        userEvent: deposit
          ? {
              kind: "deposit",
              l2PaymentCredential: deposit.l2PaymentCredential,
              l2StakeCredential: deposit.l2StakeCredential,
              l2NetworkId: deposit.l2NetworkId,
              inclusionTime: deposit.inclusionTime,
            }
          : withdrawal
            ? {
                kind: "withdrawal",
                l2Owner: withdrawal.l2Owner,
                l2OutRef: withdrawal.l2OutRef,
                inclusionTime: withdrawal.inclusionTime,
              }
            : null,
        headerHash: null,
      });
      actionFamilies.add(event.validator);
      continue;
    }
    if (event.validator === "scheduler") {
      const redeemer = tx.redeemers.find(
        (row) => familyByScript.get(row.scriptHash) === "scheduler" && row.purpose === "spend",
      );
      const decodedRedeemer = redeemer ? decodeSchedulerRedeemer(redeemer.datum) : null;
      const decodedDatum = decodeSchedulerDatum(event.datum);
      if (decodedRedeemer) {
        actions.push({
          kind: "scheduler_shift",
          family: "scheduler",
          outputIndex: event.outputIndex,
          lovelace: null,
          operation: decodedRedeemer.action,
          validContract: redeemer?.validContract ?? null,
          operator: decodedDatum?.state === "activeOperator" ? decodedDatum.operator : null,
          startTime: decodedDatum?.state === "activeOperator" ? decodedDatum.startTime : null,
          neglected: "neglected" in decodedRedeemer ? decodedRedeemer.neglected.kind : null,
          userEvent: null,
          headerHash: null,
        });
        actionFamilies.add("scheduler");
      }
    }
  }

  for (const redeemer of tx.redeemers) {
    const family = familyByScript.get(redeemer.scriptHash);
    if (!family || actionFamilies.has(family)) continue;
    actions.push({
      kind: "validator_execution",
      family,
      outputIndex: null,
      lovelace: null,
      operation: redeemer.purpose,
      validContract: redeemer.validContract,
      operator: null,
      startTime: null,
      neglected: null,
      userEvent: null,
      headerHash: null,
    });
    actionFamilies.add(family);
  }

  // Singular by nature: a transaction returns at most one collateral change
  // output. Stored with kind "collateral_output" and position 0.
  const collateralReturn = of("collateral_output")[0];

  return {
    ...rest,
    actions,
    inputs: of("input"),
    outputs: of("output").map(produced),
    referenceInputs: of("reference"),
    collateral: of("collateral"),
    collateralOutput: collateralReturn ? produced(collateralReturn) : null,
    mints: assets,
    protocolParams,
  };
}

/** Deposits, newest first. An undecoded deposit is still listed: a decoder gap
 * must be visible rather than silently shortening the list. */
export async function getL1Deposits(limit = 25) {
  const take =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 25;
  const rows = await indexerPrisma.l1Event.findMany({
    where: { validator: "deposit" },
    orderBy: [{ id: "desc" }],
    take,
    include: { tx: { include: { ios: { where: { kind: "input" } } } } },
  });
  return rows.map((row) => {
    const decoded = row.decoded as { l1OutRef?: { txHash?: string; index?: number } } | null;
    const source = decoded?.l1OutRef;
    const fundingAddresses = source
      ? [
          ...new Set(
            row.tx.ios
              .filter(
                (input) =>
                  input.sourceTxHash === source.txHash && input.sourceIndex === source.index,
              )
              .map((input) => input.address)
              .filter((address): address is string => address !== null),
          ),
        ]
      : [];
    const { ios: _ios, ...tx } = row.tx;
    return { ...row, fundingAddresses, tx };
  });
}

/** Capped the same way the deposits list is. An uncapped limit on a public
 * route lets one request ask for the whole table. */
export async function getL1BlockHeaders(limit: number) {
  return indexerPrisma.l1BlockHeader.findMany({
    orderBy: [{ endTime: "desc" }, { headerHash: "desc" }],
    take:
      Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 100)
        : 25,
  });
}

/** One header as observed in the Cardano commitment transaction. This is
 * deliberately separate from the node's `da_payloads`: it is durable L1
 * evidence, not a claim that a DA network published or retained anything. */
export async function getL1BlockHeader(headerHash: string) {
  return indexerPrisma.l1BlockHeader.findUnique({ where: { headerHash } });
}

/** Manifest identities do not depend on the node database. */
export function getManifestValidators() {
  return loadManifest(config.MIDGARD_MANIFEST_PATH).validators;
}

/** Existing indexed evidence for one validator from the active deployment.
 * No chain scan and no inferred identity: the script hash must be present in
 * the deployment manifest, then all rows come from the explorer-owned L1 DB. */
export async function getL1Validator(scriptHash: string) {
  const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);
  const validator = manifest.validators.find((row) => row.scriptHash === scriptHash) ?? null;
  if (!validator) return null;

  const [redeemers, ios, events, operations] = await Promise.all([
    indexerPrisma.l1Redeemer.findMany({
      where: { scriptHash },
      orderBy: [{ tx: { txTime: "desc" } }, { id: "desc" }],
      take: 100,
      include: { tx: true },
    }),
    indexerPrisma.l1TxIo.findMany({
      where: { address: validator.address },
      orderBy: [{ tx: { txTime: "desc" } }, { id: "desc" }],
      take: 100,
      include: { tx: true, assets: true },
    }),
    indexerPrisma.l1Event.findMany({
      where: { validator: validator.family, deployment: manifest.deploymentId },
      orderBy: [{ tx: { txTime: "desc" } }, { id: "desc" }],
      take: 100,
      include: { tx: true },
    }),
    indexerPrisma.l1Redeemer.groupBy({
      by: ["purpose", "validContract"],
      where: { scriptHash },
      _count: { _all: true },
      _sum: { memUnits: true, stepUnits: true, fee: true },
    }),
  ]);

  const outputIds = ios.filter((row) => row.kind === "output").map((row) => row.id);
  const outputRefs = ios
    .filter((row) => row.kind === "output")
    .map((row) => ({ sourceTxHash: row.sourceTxHash, sourceIndex: row.sourceIndex }));
  const spent = outputRefs.length === 0
    ? []
    : await indexerPrisma.l1TxIo.findMany({
        where: {
          kind: { in: ["input", "collateral"] },
          OR: outputRefs,
        },
        select: { sourceTxHash: true, sourceIndex: true },
      });
  const spentRefs = new Set(spent.map((row) => `${row.sourceTxHash}#${row.sourceIndex}`));
  const utxos = ios.filter(
    (row) =>
      outputIds.includes(row.id) &&
      !spentRefs.has(`${row.sourceTxHash}#${row.sourceIndex}`),
  );

  const history = new Map<
    string,
    { txHash: string; blockHeight: number; txTime: Date; ioCount: number; executionCount: number; eventCount: number }
  >();
  const touch = (tx: { txHash: string; blockHeight: number; txTime: Date }) => {
    const current = history.get(tx.txHash) ?? { ...tx, ioCount: 0, executionCount: 0, eventCount: 0 };
    history.set(tx.txHash, current);
    return current;
  };
  for (const row of ios) touch(row.tx).ioCount += 1;
  for (const row of redeemers) touch(row.tx).executionCount += 1;
  for (const row of events) touch(row.tx).eventCount += 1;

  return {
    deployment: manifest.deploymentId,
    validator,
    coverage: { limitedTo: 100, truncated: redeemers.length === 100 || ios.length === 100 || events.length === 100 },
    utxos,
    history: [...history.values()]
      .sort((a, b) => b.txTime.getTime() - a.txTime.getTime() || b.txHash.localeCompare(a.txHash))
      .slice(0, 100),
    operations: operations
      .map((row) => ({
        purpose: row.purpose,
        validContract: row.validContract,
        count: row._count._all,
        memUnits: row._sum.memUnits ?? 0n,
        stepUnits: row._sum.stepUnits ?? 0n,
        fee: row._sum.fee ?? 0n,
      }))
      .sort((a, b) => b.count - a.count || a.purpose.localeCompare(b.purpose)),
  };
}

/**
 * Anything that is not the live node database is a fixture, and the page must
 * say so. Named by exclusion rather than by an allowlist of known fixtures: a
 * new fixture must not be able to present itself as live simply by not being
 * on a list. The explorer spent weeks reporting a phase-4 test database as the
 * live chain, and no diff could show it, because the name lived in a .env.
 */
export function isFixtureDatabase(name: string): boolean {
  return name !== "midgard";
}

export type SourceIdentity = {
  deployment: string | null;
  network: string;
  deployedAt: string;
  l2Database: string;
  isFixture: boolean;
  validators: Array<{
    entryName: string;
    family: string;
    scriptHash: string;
    address: string;
  }>;
};

/** Read once. The manifest is a file written at deployment time and does not
 * change while the process runs, so reading and parsing it per request was
 * blocking the event loop to re-learn the same answer.
 *
 * Only a resolved identity is kept. A failure is transient by nature, and
 * memoising it would pin "unconfirmed" on every page until the next restart. */
let identity: SourceIdentity | null = null;

/** Which deployment these figures describe and which database they came from.
 * The boot log already names the database, which protects an operator. This is
 * the same fact where a viewer can see it.
 *
 * The database name comes from the server, not from `config`. The configured
 * name says which database was asked for, and the incident this banner exists
 * to prevent was a .env whose name did not match the connection, so echoing it
 * back would confirm nothing. `db/identity.ts` asks the same question at boot.
 *
 * Returns null rather than throwing when the manifest or the connection cannot
 * be read. The summary route is documented to answer whether or not anything
 * else is up, and a consumer that receives no source must treat it as
 * unconfirmed rather than as live, which is what the null case in the contract
 * is for. */
export async function getSourceIdentity(): Promise<SourceIdentity | null> {
  if (identity) return identity;
  try {
    const { deploymentId, network, createdAt, validators } = loadManifest(
      config.MIDGARD_MANIFEST_PATH,
    );
    const [row] = await prisma.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db;`;
    if (!row?.db) throw new Error("the connection did not name its database");
    identity = {
      deployment: deploymentId,
      network,
      deployedAt: createdAt,
      l2Database: row.db,
      isFixture: isFixtureDatabase(row.db),
      validators,
    };
  } catch (err) {
    logger.error(`Could not identify the data source: ${String(err)}`);
    return null;
  }
  return identity;
}

/** Tests only: the memo would otherwise outlive a changed configuration. */
export function resetSourceIdentity(): void {
  identity = null;
}

export async function getL1Summary() {
  const [transactions, events, blockHeaders, cursor, cursors, grouped] =
    await Promise.all([
      indexerPrisma.l1Tx.count(),
      indexerPrisma.l1Event.count(),
      indexerPrisma.l1BlockHeader.count(),
      getSyncCursor("l1"),
      getSyncCursors(),
      indexerPrisma.l1Event.groupBy({
        by: ["validator"],
        _count: { validator: true },
      }),
    ]);

  return {
    source: await getSourceIdentity(),
    transactions,
    events,
    blockHeaders,
    lastSyncedHeight: cursor?.lastBlockHeight ?? null,
    /* Why the read path publishes this: an L1 list route answers 200 with an
     * empty page whether the index holds no activity or was never built, and
     * those are different things to tell a reader. Every cursor is reported,
     * not just the verdict, because three heights that disagree say which
     * source is behind. */
    sync: {
      state: classifySyncCursors(cursors),
      cursors: SYNC_SOURCES.map((source) => ({
        source,
        height: cursors.get(source) ?? null,
      })),
    },
    byValidator: grouped
      .map((g) => ({ validator: g.validator, count: g._count.validator }))
      .sort((a, b) => b.count - a.count),
  };
}
