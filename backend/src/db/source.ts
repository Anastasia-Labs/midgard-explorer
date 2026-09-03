import { prisma } from "../db";

/**
 * What kind of L2 source this process is actually reading, and how current it is.
 *
 * Asked of PostgreSQL rather than derived from configuration. The boot log used
 * to print "replica" when `MIDGARD_READ_REPLICA_URL` was set, which reports what
 * someone intended rather than what is true, and the incident this whole area
 * exists to prevent was a URL that did not point where its name implied.
 * `pg_is_in_recovery()` cannot be wrong about it.
 *
 * The four kinds are different claims and must not collapse into two. A restored
 * snapshot of real Midgard data is real and possibly stale; a fixture is
 * synthetic and never was true. `isFixtureDatabase` named live by exclusion, so
 * it would have called a snapshot a fixture and understated it.
 */

export type L2SourceKind = "primary" | "replica" | "snapshot" | "fixture";

export type L2FreshnessState = "live" | "lagging" | "stale" | "fixed" | "synthetic" | "unknown";

export type L2Source = {
  kind: L2SourceKind;
  database: string;
  /** When this source last had something true to say, as an ISO string. */
  observedAsOf: string | null;
  /** Replay lag for a standby, or snapshot age. Null where it does not apply. */
  lagSeconds: number | null;
  freshness: L2FreshnessState;
};

/** The database the live node writes to. Anything else is a fixture unless it
 * identifies itself as something better, which is what the snapshot marker is
 * for. Named by exclusion on purpose: a new fixture must not be able to present
 * itself as live simply by not being on a list. */
const LIVE_DATABASE = "midgard";

/** Written by the snapshot restore. A snapshot that does not identify itself is
 * indistinguishable from a fixture, and being called a fixture is the safe way
 * for that to fail. */
const SNAPSHOT_MARKER = "explorer_snapshot_meta";

/**
 * Beyond this silence, a WAL receiver is not evidence of anything.
 *
 * A streaming receiver exchanges keepalives every
 * `wal_receiver_status_interval`, 10 seconds by default, so a minute without a
 * message is a connection that has died without updating its status. Six
 * intervals rather than two, because a busy or briefly paused primary should
 * not turn a healthy standby "unknown".
 */
const RECEIVER_SILENT_AFTER_SECONDS = 60;

export type SourceProbe = {
  db: string;
  in_recovery: boolean;
  replay_at: Date | null;
  has_snapshot_marker: boolean;
  newest_block: Date | null;
  /**
   * Whether a standby still has received WAL it has not replayed.
   *
   * This is REPLAY BACKLOG, and it is deliberately not called lag. It compares
   * what this standby received against what it replayed, so it says nothing
   * about what the primary has produced that this standby never received: a
   * receiver that disconnected an hour ago reports no backlog at all, having
   * faithfully replayed everything it holds.
   *
   * It is still worth having, because the replay TIMESTAMP cannot answer even
   * this much. `pg_last_xact_replay_timestamp()` reports when the last replayed
   * transaction was written, so on a quiet primary it stops advancing and a
   * perfectly current replica drifted to "lagging" and then "stale" purely
   * because the chain was quiet.
   *
   * Null on a primary, and on a standby that has received nothing yet.
   */
  replay_backlog: boolean | null;
  /**
   * The WAL receiver's own state, from `pg_stat_wal_receiver`.
   *
   * Null when there is no receiver row: either the standby is not streaming
   * (restoring from an archive, or disconnected), or this role cannot read the
   * view. `pg_stat_wal_receiver` is restricted to superusers and members of
   * `pg_read_all_stats`, so an unprivileged explorer role sees nothing and the
   * source is reported as unknown rather than assumed current. Grant
   * `pg_read_all_stats` to get a real answer.
   */
  receiver_status: string | null;
  /** Seconds since the receiver last heard from the primary. A streaming
   * receiver exchanges keepalives on `wal_receiver_status_interval` (10s by
   * default), so silence well past that is a connection that has died without
   * saying so. */
  receiver_silent_seconds: number | null;
  /** When the snapshot was captured, from the marker the restore wrote. Null
   * unless this database IS a snapshot. */
  snapshot_captured_at: Date | null;
};

/** No duration anywhere in here. A primary is live by definition, a snapshot is
 * fixed, a fixture is synthetic, and a replica answers for itself below. The
 * second-based thresholds this used to apply were dead the moment replicas
 * stopped reporting a lag: every remaining caller passed null. */
const freshnessFor = (kind: Exclude<L2SourceKind, "replica">): L2FreshnessState =>
  kind === "fixture" ? "synthetic" : kind === "snapshot" ? "fixed" : "live";

/**
 * One round trip, because this is read on request paths.
 *
 * `pg_last_xact_replay_timestamp()` is null on a primary and on a standby that
 * has replayed nothing, so a null lag is reported as unknown rather than as
 * zero. Reporting zero would say "perfectly current" about a standby that may
 * not have started.
 */
export async function readL2Source(): Promise<L2Source> {
  const [row] = await prisma.$queryRaw<SourceProbe[]>`
    SELECT current_database() AS db,
           pg_is_in_recovery() AS in_recovery,
           pg_last_xact_replay_timestamp() AS replay_at,
           EXISTS (
             SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = ${SNAPSHOT_MARKER}
           ) AS has_snapshot_marker,
           (SELECT MAX(block_end_time) FROM pending_block_finalizations) AS newest_block,
           CASE WHEN pg_is_in_recovery()
                THEN pg_last_wal_receive_lsn() IS DISTINCT FROM pg_last_wal_replay_lsn()
                ELSE NULL END AS replay_backlog,
           (SELECT status FROM pg_stat_wal_receiver LIMIT 1) AS receiver_status,
           (SELECT EXTRACT(EPOCH FROM (now() - last_msg_receipt_time))
              FROM pg_stat_wal_receiver LIMIT 1)::float8 AS receiver_silent_seconds;`;

  if (!row) throw new Error("the node connection did not describe itself");

  // A second round trip, and only for a snapshot. The marker table cannot be
  // referenced in the query above: a table name is an identifier and not a
  // parameter, and naming a table that does not exist fails the whole
  // statement on every primary and replica.
  let capturedAt: Date | null = null;
  if (row.has_snapshot_marker) {
    const marker = await prisma.$queryRaw<Array<{ captured_at: Date | null }>>`
      SELECT captured_at FROM explorer_snapshot_meta LIMIT 1;`;
    capturedAt = marker[0]?.captured_at ?? null;
  }

  return classifySource({ ...row, snapshot_captured_at: capturedAt }, Date.now());
}

/**
 * The classification, separated from the round trip so it can be tested.
 *
 * The order matters and is not alphabetical. A restored snapshot is checked
 * FIRST, because it is neither in recovery nor named `midgard`, so every later
 * branch would call it a fixture: real data reported as synthetic, which is the
 * mistake the old boolean made by construction.
 */
export function classifySource(row: SourceProbe, now: number): L2Source {
  const kind: L2SourceKind = row.has_snapshot_marker
    ? "snapshot"
    : row.in_recovery
      ? "replica"
      : row.db === LIVE_DATABASE
        ? "primary"
        : "fixture";

  // A snapshot says when it was captured, from the marker the restore wrote.
  // It used to report the newest block it happened to contain, which describes
  // the chain rather than the capture and drifts from it by however long the
  // source had been quiet.
  const reference =
    kind === "snapshot"
      ? (row.snapshot_captured_at ?? row.newest_block)
      : kind === "replica"
        ? row.replay_at
        : row.newest_block;

  // What a standby can and cannot prove about itself.
  //
  // It can prove it replayed everything it RECEIVED, and that its receiver is
  // connected and recently heard from. It cannot prove it received everything
  // the primary produced: that is a comparison against the primary's current
  // WAL position, or a heartbeat written by the primary and read here, and
  // neither is available from this connection.
  //
  // So `live` requires a streaming receiver that has heard from the primary
  // recently AND no replay backlog. Anything else is `unknown`, except a
  // connected receiver with a backlog, which is genuinely behind by an amount
  // this cannot express in seconds.
  const replicaFreshness = (): L2FreshnessState => {
    if (row.receiver_status !== "streaming") return "unknown";
    if (
      row.receiver_silent_seconds === null ||
      row.receiver_silent_seconds > RECEIVER_SILENT_AFTER_SECONDS
    ) {
      return "unknown";
    }
    return row.replay_backlog === true ? "lagging" : "live";
  };

  // Null for a replica, always. Every figure available here measures this
  // standby against itself, and presenting one as "seconds behind the chain"
  // is the overstatement this exists to avoid. A real number needs a primary
  // comparison or a heartbeat.
  const freshness: L2FreshnessState =
    kind === "replica" ? replicaFreshness() : freshnessFor(kind);

  return {
    kind,
    database: row.db,
    observedAsOf: reference === null ? null : reference.toISOString(),
    lagSeconds: null,
    freshness,
  };
}

/** Exported for the tests that pin the wording, so the thresholds live in one
 * place rather than being restated as literals in assertions. */
export const SOURCE_THRESHOLDS = {
  receiverSilentAfterSeconds: RECEIVER_SILENT_AFTER_SECONDS,
  liveDatabase: LIVE_DATABASE,
  snapshotMarker: SNAPSHOT_MARKER,
} as const;
