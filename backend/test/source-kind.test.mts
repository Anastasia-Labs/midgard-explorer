import { describe, expect, it } from "vitest";
import { classifySource, SOURCE_THRESHOLDS, type SourceProbe } from "../src/db/source.js";

/**
 * Four kinds of source, because two were not enough.
 *
 * `isFixtureDatabase` named live by exclusion: anything not called `midgard` was
 * a fixture. That is right about fixtures and wrong about a restored snapshot of
 * real Midgard data, which is neither live nor synthetic. Reporting real data as
 * a test fixture understates it exactly as badly as the reverse overstates it.
 *
 * The probe values here are the ones PostgreSQL actually returns, verified
 * against the running node and a restored snapshot database:
 *
 *   midgard           in_recovery=f  marker=f  -> primary
 *   midgard_snapshot  in_recovery=f  marker=t  -> snapshot
 */

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const ago = (seconds: number) => new Date(NOW - seconds * 1000);

const probe = (over: Partial<SourceProbe> = {}): SourceProbe => ({
  db: "midgard",
  in_recovery: false,
  replay_at: null,
  has_snapshot_marker: false,
  newest_block: ago(10),
  // No standby by default, so a replica case has to state its own receiver
  // health rather than inheriting a healthy one.
  replay_backlog: null,
  receiver_status: null,
  receiver_silent_seconds: null,
  snapshot_captured_at: null,
  ...over,
});

describe("which kind of source this is", () => {
  it("calls the live node database primary", () => {
    expect(classifySource(probe(), NOW).kind).toBe("primary");
  });

  /** `pg_is_in_recovery()` cannot be wrong about a standby, which is why this
   * is asked of PostgreSQL rather than read from a configured URL. */
  it("calls a server in recovery a replica, whatever it is named", () => {
    const standby = probe({
      db: "midgard",
      in_recovery: true,
      replay_at: ago(2),
    });
    expect(classifySource(standby, NOW).kind).toBe("replica");
  });

  /** The case the old boolean got wrong. Checked before the name, because a
   * snapshot is not called `midgard` and every later branch would say fixture. */
  it("calls a restored snapshot a snapshot, not a fixture", () => {
    const snapshot = probe({
      db: "midgard_snapshot",
      has_snapshot_marker: true,
    });
    expect(classifySource(snapshot, NOW).kind).toBe("snapshot");
  });

  it("still calls an unmarked unknown database a fixture", () => {
    const other = probe({ db: "midgard_phase4_process_txcoverage" });
    expect(classifySource(other, NOW).kind).toBe("fixture");
  });

  /** A snapshot restored over the live name is still a snapshot. The marker is
   * evidence; the name is a convention. */
  it("prefers the marker over the database name", () => {
    const marked = probe({
      db: SOURCE_THRESHOLDS.liveDatabase,
      has_snapshot_marker: true,
    });
    expect(classifySource(marked, NOW).kind).toBe("snapshot");
  });
});

/** A standby whose receiver is connected and has just heard from the primary,
 * with nothing received left to replay. */
const streaming = (over: Partial<SourceProbe> = {}): SourceProbe =>
  probe({
    in_recovery: true,
    replay_at: ago(2),
    replay_backlog: false,
    receiver_status: "streaming",
    receiver_silent_seconds: 3,
    ...over,
  });

describe("how current the source is", () => {
  it("reports a healthy standby as live", () => {
    expect(classifySource(streaming(), NOW).freshness).toBe("live");
  });

  /**
   * The false alarm this replaces.
   *
   * `pg_last_xact_replay_timestamp()` reports when the last replayed
   * transaction was WRITTEN, so it stops advancing whenever the primary is
   * quiet. A standby that had replayed everything it received therefore drifted
   * to "lagging" and then "stale" purely because the chain was quiet, raising
   * an alarm about the component the association model is meant to trust.
   */
  it("calls a connected standby live however quiet the chain has been", () => {
    const quiet = streaming({ replay_at: ago(60 * 60 * 24 * 7) });
    expect(classifySource(quiet, NOW).freshness).toBe("live");
  });

  /**
   * The overstatement this replaces.
   *
   * Replaying everything RECEIVED says nothing about what was never received. A
   * standby whose receiver died an hour ago has no replay backlog at all: it
   * faithfully replayed every byte it holds, and holds an hour less than the
   * primary. Reporting that as live is the specific claim this cannot make.
   */
  it("does not call a standby live when its receiver is gone", () => {
    const disconnected = streaming({
      receiver_status: null,
      receiver_silent_seconds: null,
    });
    expect(classifySource(disconnected, NOW).freshness).toBe("unknown");
  });

  /** A receiver row exists but is not streaming: starting up, or shutting
   * down. Neither is evidence that this standby is current. */
  it("does not call a standby live when its receiver is not streaming", () => {
    const starting = streaming({ receiver_status: "startup" });
    expect(classifySource(starting, NOW).freshness).toBe("unknown");
  });

  /** Keepalives arrive on `wal_receiver_status_interval`, so silence far past
   * it means the connection died without saying so. The status column is the
   * receiver's own opinion and it can be out of date. */
  it("does not trust a streaming status that has gone quiet", () => {
    const silent = streaming({ receiver_silent_seconds: 600 });
    expect(classifySource(silent, NOW).freshness).toBe("unknown");
  });

  /** `pg_stat_wal_receiver` is readable only by superusers and
   * `pg_read_all_stats`, so an unprivileged role sees no row. Unknown is the
   * honest answer: the standby may be perfectly healthy, and this connection
   * cannot tell. */
  it("reports unknown when the role cannot read the receiver view", () => {
    const unprivileged = streaming({
      receiver_status: null,
      receiver_silent_seconds: null,
    });
    expect(classifySource(unprivileged, NOW).freshness).toBe("unknown");
  });

  it("reports a connected standby with replay backlog as lagging", () => {
    const behind = streaming({ replay_backlog: true });
    expect(classifySource(behind, NOW).freshness).toBe("lagging");
  });

  /**
   * Never a number of seconds for a replica.
   *
   * Every figure available from a standby measures it against ITSELF. True lag
   * is the primary's current WAL position against this standby's received
   * position, or a heartbeat the primary writes and this reads, and neither is
   * available here. A number would be read as "seconds behind the chain", which
   * is precisely what it would not be.
   */
  it("never presents a replica figure as seconds behind the chain", () => {
    for (const source of [
      classifySource(streaming(), NOW),
      classifySource(streaming({ replay_backlog: true }), NOW),
      classifySource(streaming({ receiver_status: null }), NOW),
    ]) {
      expect(source.lagSeconds).toBeNull();
    }
  });

  /** A snapshot does not advance, and is not stale for failing to. It is fixed,
   * which is a different claim and the one a reader needs. */
  it("calls a snapshot fixed rather than stale, however old", () => {
    const old = probe({
      db: "midgard_snapshot",
      has_snapshot_marker: true,
      newest_block: ago(60 * 60 * 24 * 30),
    });
    expect(classifySource(old, NOW).freshness).toBe("fixed");
  });

  /** A snapshot reports when it was CAPTURED, from the marker the restore
   * wrote. It used to report the newest block it happened to contain, which
   * describes the chain rather than the capture and drifts from it by however
   * long the source had been quiet before the dump. */
  it("reports a snapshot's capture time, not its newest block", () => {
    const captured = ago(60 * 60);
    const snapshot = probe({
      db: "midgard_snapshot",
      has_snapshot_marker: true,
      newest_block: ago(60 * 60 * 24 * 30),
      snapshot_captured_at: captured,
    });
    expect(classifySource(snapshot, NOW).observedAsOf).toBe(captured.toISOString());
  });

  /** Fixture data has no relationship to time at all. */
  it("calls fixture data synthetic", () => {
    expect(classifySource(probe({ db: "anything_else" }), NOW).freshness).toBe("synthetic");
  });

  /** Lag is a replica concept. A primary is never behind itself, and reporting
   * the age of its newest block as lag made a live source contradict itself:
   * `state: "live"` beside `lagSeconds: 1748752` on a twenty-day-quiet chain. */
  it("reports no lag for a primary, however old its newest block", () => {
    const quiet = probe({ newest_block: ago(60 * 60 * 24 * 20) });
    const source = classifySource(quiet, NOW);
    expect(source.kind).toBe("primary");
    expect(source.lagSeconds).toBeNull();
    expect(source.freshness).toBe("live");
    expect(source.observedAsOf).toBe(ago(60 * 60 * 24 * 20).toISOString());
  });

  /** A standby's clock can run ahead of this process's. That used to produce a
   * negative lag, which was clamped to zero and read as "perfectly current".
   * There is no duration to get wrong any more: the replica reports WHEN it
   * last replayed, and the reader compares that to their own clock. */
  it("reports a replica's last replay as a time, not as a duration", () => {
    const ahead = streaming({ replay_at: new Date(NOW + 5000) });
    const source = classifySource(ahead, NOW);
    expect(source.lagSeconds).toBeNull();
    expect(source.observedAsOf).toBe(new Date(NOW + 5000).toISOString());
  });
});
