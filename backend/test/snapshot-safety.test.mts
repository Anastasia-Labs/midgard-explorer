import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TABLES } from "../scripts/snapshot.mjs";

/**
 * The snapshot tool, exercised against real throwaway databases.
 *
 * Every other test here reaches the tool through a module boundary. This one
 * cannot: the danger in `snapshot.mjs` is not in any function's return value,
 * it is in `pg_restore --clean` dropping objects in a database the tool
 * misjudged as its own. That judgement is made from live catalogue queries and
 * carried out by subprocesses, so a test that stubs either is not testing the
 * thing that can destroy data.
 *
 * So these cases build databases, hand them to the real CLI, and assert on what
 * it refuses. Every database created here ends in `_test` and is dropped again,
 * and the refusal cases are pointed at databases holding data the assertions
 * then confirm SURVIVED.
 */

const SRC = "midgard_snapshot_src_test";
const DEST = "midgard_snapshot_dest_test";
const FOREIGN = "midgard_snapshot_foreign_test";

const script = resolve(import.meta.dirname, "../scripts/snapshot.mjs");
const schema = resolve(import.meta.dirname, "fixtures/schema/midgard-node.sql");
const seed = resolve(import.meta.dirname, "fixtures/schema/midgard-node-seed.sql");

let reachable = false;
let adminUrl = "";
let container = "";
let out = "";
let archive = "";

/** Same host and credentials as the guarded indexer test database, a different
 * database name. Nothing here ever touches the configured live databases. */
const urlFor = (database: string) => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

/** Redacts on failure. `execFileSync` puts the whole command line into the
 * error message, and these command lines carry a database password. */
const psql = (url: string, sql: string) => {
  try {
    return execFileSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql, url], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch (err) {
    const e = err as { stderr?: string };
    throw new Error(`psql failed for: ${sql}\n${e.stderr ?? ""}`);
  }
};

/** Through psql rather than dropdb/createdb: those take connection flags rather
 * than a URL, and a failed invocation echoes its whole command line including
 * the password. Names are literals defined in this file, never input. */
const dropDb = (name: string) => psql(adminUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);

const createDb = (name: string) => {
  dropDb(name);
  psql(adminUrl, `CREATE DATABASE "${name}";`);
};

type Run = { status: number; stdout: string; stderr: string };

/** The CLI as an operator runs it. `die()` exits the process, so the failure
 * modes under test are exit codes and stderr, not thrown values. */
const snapshot = (argv: string[], env: Record<string, string>): Run => {
  try {
    const stdout = execFileSync("node", [script, ...argv], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
};

const manifestPath = (a: string) => `${a}.json`;
const readManifest = (a: string) => JSON.parse(readFileSync(manifestPath(a), "utf8"));
const writeManifest = (a: string, meta: unknown) =>
  writeFileSync(manifestPath(a), `${JSON.stringify(meta, null, 2)}\n`);

/** The major version of the local client. `snapshot.mjs` refuses to run a
 * client against a server of a different major version, because pg_dump writes
 * a preamble the other server cannot read, so a test needs a server this client
 * can legitimately talk to before it can exercise anything at all. */
const clientMajor = () => {
  const version = execFileSync("pg_dump", ["--version"], { encoding: "utf8" });
  return Number(version.match(/(\d+)/)?.[1]);
};

const serverMajor = (url: string) => Number(psql(url, "SHOW server_version;").split(".")[0]);

/** A server of the client's own major version, thrown away afterwards.
 * Preferred over the shared test server when that one is a different major,
 * which is the normal case on a workstation whose client tracks the distro. */
const startThrowawayServer = (major: number): string => {
  const name = `midgard-snapshot-test-${process.pid}`;
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_PASSWORD=throwaway",
      "-p",
      "127.0.0.1:0:5432",
      `postgres:${major}-alpine`,
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
  container = name;
  const port = execFileSync("docker", ["port", name, "5432/tcp"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")[0]
    .split(":")
    .pop();
  const url = `postgresql://postgres:throwaway@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      psql(url, "SELECT 1;");
      return url;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  throw new Error("throwaway Postgres did not become ready");
};

beforeAll(() => {
  const configured = process.env.TEST_INDEXER_POSTGRES_URL ?? process.env.INDEXER_POSTGRES_URL;
  if (!configured) {
    if (process.env.REQUIRE_DB === "1") throw new Error("No indexer Postgres URL configured.");
    return;
  }
  const probe = new URL(configured);
  probe.pathname = "/postgres";
  const configuredAdmin = probe.toString();

  try {
    const major = clientMajor();
    adminUrl = configuredAdmin;
    if (serverMajor(adminUrl) !== major) {
      // Not a skip. The tool's own version guard would refuse to run here, so
      // the suite brings a server the client matches rather than reporting a
      // pass it never earned.
      adminUrl = startThrowawayServer(major);
    }
    reachable = true;
  } catch (err) {
    if (process.env.REQUIRE_DB === "1") throw err;
    console.warn(`Skipping snapshot safety: no usable Postgres. ${String(err)}`);
    return;
  }

  createDb(SRC);
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", schema, urlFor(SRC)], {
    stdio: "pipe",
  });
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", seed, urlFor(SRC)], { stdio: "pipe" });

  // A table the explorer does not read, holding data nobody should copy into a
  // read-only browsing database. Created BEFORE the export, so the archive
  // under test is one that had the opportunity to carry it.
  psql(
    urlFor(SRC),
    `CREATE TABLE operator_secrets (id int primary key, token text NOT NULL);
     INSERT INTO operator_secrets VALUES (1, 'canary-must-not-travel');`,
  );

  out = mkdtempSync(join(tmpdir(), "snapshot-safety-"));
  const exported = snapshot(["export", `--out=${out}`], {
    // A PRISMA-shaped URL, deliberately. `POSTGRES_URL` in this repository
    // carries `?schema=public`, which libpq rejects outright ("invalid URI query
    // parameter: schema"), so a capture that hands the URL to psql instead of
    // using the PG* environment fails on the only URL an operator actually has.
    // Every case below depends on this export, so the whole file covers it.
    POSTGRES_URL: `${urlFor(SRC)}?schema=public`,
  });
  if (exported.status !== 0) throw new Error(`export failed: ${exported.stderr}`);
  archive = resolve(out, exported.stdout.match(/(\S+\.dump)/)?.[1] ?? "");
}, 180_000);

afterAll(() => {
  if (!reachable) return;
  if (container === "") {
    for (const name of [SRC, DEST, FOREIGN]) dropDb(name);
    return;
  }
  // The whole server was the throwaway.
  execFileSync("docker", ["rm", "-f", container], { stdio: "pipe" });
});

describe("the seed the gates load", () => {
  /* A fixture is only worth what it agrees with.
   *
   * `pending_block_finalizations.expected_l2_transaction_count` is what every
   * block list in the explorer reads, and `pending_block_finalization_txs` is
   * the transactions themselves. The generator left the first to a placeholder
   * of zero while writing six of the second, so the seed described blocks that
   * carry nothing and then listed their contents. The schema's own check
   * constraints did not catch it: all zeros satisfy a sum trivially.
   *
   * It survived because the case that compares the two returns early against a
   * database holding fifty blocks, which is every developer machine, and CI had
   * no node data at all until the seed was applied there. This asserts it where
   * the seed is already loaded. */
  it("claims exactly the transactions it lists", () => {
    if (!reachable) return;
    expect(
      psql(urlFor(SRC), "SELECT COALESCE(sum(expected_l2_transaction_count), 0) FROM pending_block_finalizations;"),
      "the blocks claim a different number of transactions than the seed lists",
    ).toBe(psql(urlFor(SRC), "SELECT count(*) FROM pending_block_finalization_txs;"));
  });
});

describe("verifying an archive", () => {
  it("accepts the archive the tool just wrote", () => {
    if (!reachable) return;
    const result = snapshot(["verify", archive], {});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified");
    // `readMeta` used to discard `consistency`, so this line printed
    // "(undefined)" for every archive ever verified.
    expect(result.stdout).toMatch(/\((serializable-deferrable|repeatable-read)\)/);
  });

  it("refuses an archive renamed away from its manifest", () => {
    if (!reachable) return;
    const renamed = join(out, "not-the-archive.dump");
    renameSync(archive, renamed);
    renameSync(manifestPath(archive), manifestPath(renamed));
    try {
      const result = snapshot(["verify", renamed], {});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("names archive");
    } finally {
      renameSync(renamed, archive);
      renameSync(manifestPath(renamed), manifestPath(archive));
    }
  });

  it("refuses an archive whose size disagrees with the manifest", () => {
    if (!reachable) return;
    const copy = join(out, "truncated.dump");
    writeFileSync(copy, readFileSync(archive));
    writeManifest(copy, { ...readManifest(archive), archive: basename(copy) });
    truncateSync(copy, 64);
    const result = snapshot(["verify", copy], {});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bytes");
  });

  it("refuses a manifest from another version of this tool", () => {
    if (!reachable) return;
    const copy = join(out, "versioned.dump");
    writeFileSync(copy, readFileSync(archive));
    writeManifest(copy, {
      ...readManifest(archive),
      archive: basename(copy),
      version: 2,
    });
    const result = snapshot(["verify", copy], {});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("version");
  });
});

describe("a manifest that is missing a table", () => {
  /** The point of the case: this is caught by `verify`, and by `restore` BEFORE
   * it drops anything. It used to surface as an `undefined` row count compared
   * after the target had already been dropped and rewritten. */
  it("is refused before the target is touched", () => {
    if (!reachable) return;
    const copy = join(out, "incomplete.dump");
    writeFileSync(copy, readFileSync(archive));
    const meta = readManifest(archive);
    const { blocks: _dropped, ...rowCounts } = meta.rowCounts;
    writeManifest(copy, { ...meta, archive: basename(copy), rowCounts });

    createDb(DEST);
    psql(urlFor(DEST), "CREATE TABLE canary (id int);");
    const result = snapshot(["restore", copy], {
      SNAPSHOT_TARGET_URL: urlFor(DEST),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("blocks");
    expect(
      psql(
        urlFor(DEST),
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'canary';",
      ),
      "the target was modified despite an invalid manifest",
    ).toBe("1");
  });
});

describe("deciding whether the tool owns the target", () => {
  /** A database holding only a view counted as "empty" while `information_schema
   * .tables` was the measure, and `pg_restore --clean` was therefore in scope
   * for it. */
  it("does not call a database holding only a view empty", () => {
    if (!reachable) return;
    createDb(FOREIGN);
    psql(urlFor(FOREIGN), "CREATE VIEW someone_elses AS SELECT 1 AS n;");
    const result = snapshot(["restore", archive], {
      SNAPSHOT_TARGET_URL: urlFor(FOREIGN),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("did not put there");
    expect(psql(urlFor(FOREIGN), "SELECT n FROM someone_elses;"), "the view was dropped").toBe("1");
  });

  /** Name-only ownership: any table called `explorer_snapshot_meta`, whatever
   * its shape, used to hand the whole database over. */
  it("does not accept a lookalike marker table", () => {
    if (!reachable) return;
    createDb(FOREIGN);
    psql(
      urlFor(FOREIGN),
      "CREATE TABLE explorer_snapshot_meta (note text); INSERT INTO explorer_snapshot_meta VALUES ('not ours');",
    );
    const result = snapshot(["restore", archive], {
      SNAPSHOT_TARGET_URL: urlFor(FOREIGN),
    });
    expect(result.status).not.toBe(0);
    expect(psql(urlFor(FOREIGN), "SELECT note FROM explorer_snapshot_meta;")).toBe("not ours");
  });

  it("does not accept a marker that is not a singleton", () => {
    if (!reachable) return;
    createDb(FOREIGN);
    psql(
      urlFor(FOREIGN),
      `CREATE TABLE explorer_snapshot_meta (
         captured_at timestamptz NOT NULL, source_database text NOT NULL,
         deployment_id text, network text, archive_sha256 text NOT NULL,
         restored_at timestamptz NOT NULL DEFAULT now());
       INSERT INTO explorer_snapshot_meta (captured_at, source_database, archive_sha256)
       VALUES (now(), 'a', 'x'), (now(), 'b', 'y');`,
    );
    const result = snapshot(["restore", archive], {
      SNAPSHOT_TARGET_URL: urlFor(FOREIGN),
    });
    expect(result.status).not.toBe(0);
    expect(psql(urlFor(FOREIGN), "SELECT count(*) FROM explorer_snapshot_meta;")).toBe("2");
  });
});

describe("restoring into a database the tool may write", () => {
  it("reproduces the source row counts and claims the target", () => {
    if (!reachable) return;
    createDb(DEST);
    const result = snapshot(["restore", archive], {
      SNAPSHOT_TARGET_URL: urlFor(DEST),
    });
    expect(result.status, result.stderr).toBe(0);

    for (const table of TABLES) {
      expect(
        psql(urlFor(DEST), `SELECT count(*) FROM "${table}";`),
        `${table} does not match the source`,
      ).toBe(psql(urlFor(SRC), `SELECT count(*) FROM "${table}";`));
    }

    expect(psql(urlFor(DEST), "SELECT count(*) FROM explorer_snapshot_meta;")).toBe("1");
    expect(psql(urlFor(DEST), "SELECT archive_sha256 FROM explorer_snapshot_meta;")).toBe(
      readManifest(archive).archiveSha256,
    );
    // A local copy that permits writes invites a divergence nothing notices.
    expect(
      psql(
        urlFor(DEST),
        `SELECT count(*) FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
          WHERE d.datname = '${DEST}' AND 'default_transaction_read_only=on' = ANY(s.setconfig);`,
      ),
    ).toBe("1");
  }, 180_000);

  /**
   * The data boundary, which is the reason this suite exists in its current
   * form. Fixing the missing enum types by dumping the whole schema also made
   * the archive carry the rows of every table the node owns. The definition
   * still travels, because a restore has to reproduce a working schema; the
   * rows do not.
   */
  it("carries the schema of an unrelated table but never its rows", () => {
    if (!reachable) return;
    expect(
      psql(urlFor(DEST), "SELECT count(*) FROM pg_tables WHERE tablename = 'operator_secrets';"),
      "the unrelated table's definition did not survive the restore",
    ).toBe("1");
    expect(
      psql(urlFor(DEST), "SELECT count(*) FROM operator_secrets;"),
      "rows the explorer never reads were copied into the snapshot",
    ).toBe("0");
    expect(psql(urlFor(SRC), "SELECT count(*) FROM operator_secrets;")).toBe("1");
  });

  /** The second restore is the one that proves ownership is durable: the target
   * now holds a real marker, so the tool recognises its own work and replaces
   * it without a --force flag. */
  it("restores again over its own snapshot", () => {
    if (!reachable) return;
    const result = snapshot(["restore", archive], {
      SNAPSHOT_TARGET_URL: urlFor(DEST),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(psql(urlFor(DEST), "SELECT count(*) FROM explorer_snapshot_meta;")).toBe("1");
  }, 180_000);
});

/** Rows for `tx_admissions`, whose real columns this needs to match. An
 * INSERT that fails writes nothing, and a writer that silently writes nothing
 * races nothing: the first version of the case below piped its errors to
 * /dev/null and passed against the defect it was written to catch. */
const bulkInsert = (salt: string, from: number | string, to: number | string) =>
  `INSERT INTO tx_admissions ` +
  `(tx_id, tx_canonical_cbor, tx_canonical_cbor_sha256, arrival_seq, status, submit_source) ` +
  `SELECT decode(md5(g::text || ${salt}) || md5(${salt} || g::text), 'hex'), '\\x00'::bytea, decode(md5(g::text) || md5(g::text), 'hex'), ` +
  `g + 5000000, 'queued'::tx_admission_status, 'backfill' ` +
  `FROM generate_series(${from}, ${to}) g`;

describe("the manifest describes the archive, not a later database", () => {
  /**
   * The false failure this prevents.
   *
   * `pg_dump` takes a snapshot; the row counts used to be gathered afterwards
   * through eighteen separate statements. On a node that is still ingesting,
   * those counts describe a database the archive does not contain, so the
   * restore's own verification rejected a capture that was perfectly good.
   *
   * Rows are inserted DURING the capture here. The manifest must report the
   * database as it was when the dump began, which is also what a restore of
   * that archive produces.
   */
  it("ignores rows written while the capture is running", async () => {
    if (!reachable) return;

    const out2 = mkdtempSync(join(tmpdir(), "snapshot-during-write-"));

    // Enough rows that the dump takes long enough for a concurrent writer to
    // land inside it. With the fixture's handful of rows the capture finished
    // in a few milliseconds and nothing could race it, so the case passed
    // against the very defect it exists to catch.
    psql(urlFor(SRC), `${bulkInsert("'bulk'", 1, 200000)};`);
    const before = Number(psql(urlFor(SRC), "SELECT count(*) FROM tx_admissions;"));

    // A separate PROCESS, not a timer. `snapshot()` runs the CLI through
    // `execFileSync`, which blocks this event loop entirely: a `setTimeout`
    // writer fires only after the capture has finished and races nothing, which
    // is how the first version of this case passed against the very defect it
    // was written to catch.
    const writer = spawn(
      "bash",
      [
        "-c",
        `for i in $(seq 1 200); do psql -X -q -v ON_ERROR_STOP=1 -c ` +
          `"${bulkInsert("'race' || $i::text", "900000 + $i * 10", "900009 + $i * 10")}" ` +
          `"${urlFor(SRC)}" || exit 1; sleep 0.02; done`,
      ],
      { stdio: "ignore" },
    );

    let exported: Run;
    try {
      exported = snapshot(["export", `--out=${out2}`], { POSTGRES_URL: urlFor(SRC) });
    } finally {
      writer.kill("SIGKILL");
    }
    expect(exported.status, exported.stderr).toBe(0);

    const archive2 = resolve(out2, exported.stdout.match(/(\S+\.dump)/)?.[1] ?? "");
    const meta = JSON.parse(readFileSync(`${archive2}.json`, "utf8"));

    // Whatever the writer managed, the manifest agrees with the archive: its
    // own verify and a restore both accept it.
    expect(snapshot(["verify", archive2], {}).status).toBe(0);
    expect(meta.rowCounts.tx_admissions).toBeGreaterThanOrEqual(before);

    createDb(DEST);
    const restored = snapshot(["restore", archive2], { SNAPSHOT_TARGET_URL: urlFor(DEST) });
    expect(restored.status, restored.stderr).toBe(0);
    expect(psql(urlFor(DEST), "SELECT count(*) FROM tx_admissions;")).toBe(
      String(meta.rowCounts.tx_admissions),
    );
  }, 180_000);
});

describe("a restore that fails part way", () => {
  /**
   * The window this closes.
   *
   * The restore used to clear the database-level read-only setting, do its
   * work, and set it again at the end. Everything in between ran against a
   * writable snapshot, so any failure in that stretch left the database open to
   * writes with nothing to say so. A session-level override does the same job
   * and dies with the process that asked for it.
   */
  it("leaves the database read-only when the archive is rejected", () => {
    if (!reachable) return;

    createDb(DEST);
    const good = snapshot(["restore", archive], { SNAPSHOT_TARGET_URL: urlFor(DEST) });
    expect(good.status, good.stderr).toBe(0);
    const claimed = psql(urlFor(DEST), "SELECT archive_sha256 FROM explorer_snapshot_meta;");

    // A failure INSIDE the destructive stretch. A bad checksum is refused before
    // the target is touched and proves nothing here; a schema fingerprint that
    // does not match is checked after `pg_restore` has already dropped and
    // rewritten the schema, which is where the old code cleared the read-only
    // setting and dropped the ownership marker.
    const late = join(out, "late-failure.dump");
    writeFileSync(late, readFileSync(archive));
    writeManifest(late, {
      ...readManifest(archive),
      archive: basename(late),
      schemaFingerprint: "9".repeat(64),
    });

    const failed = snapshot(["restore", late], { SNAPSHOT_TARGET_URL: urlFor(DEST) });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toMatch(/schema does not match/i);

    expect(
      psql(
        urlFor(DEST),
        `SELECT count(*) FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
          WHERE d.datname = '${DEST}' AND 'default_transaction_read_only=on' = ANY(s.setconfig);`,
      ),
      "a failed restore left the snapshot database writable",
    ).toBe("1");

    // Unmarked, NOT marked with the archive that failed. The rows in there came
    // from an archive whose verification did not pass, and calling that a valid
    // snapshot is the lie this avoids. Reclaiming it costs a --force.
    expect(
      psql(
        urlFor(DEST),
        "SELECT count(*) FROM pg_tables WHERE tablename = 'explorer_snapshot_meta';",
      ),
      "a failed restore claimed the database for an archive it could not verify",
    ).toBe("0");
    expect(claimed).toHaveLength(64);
  }, 180_000);

  /**
   * A refusal BEFORE anything is written keeps the identity the database
   * already had. The failing archive's identity must never be written over data
   * it did not produce, and the surviving snapshot must stay usable without a
   * --force.
   */
  it("keeps the previous snapshot's identity when nothing was replaced", () => {
    if (!reachable) return;

    createDb(DEST);
    expect(snapshot(["restore", archive], { SNAPSHOT_TARGET_URL: urlFor(DEST) }).status).toBe(0);
    const before = psql(
      urlFor(DEST),
      "SELECT archive_sha256 || '|' || captured_at FROM explorer_snapshot_meta;",
    );
    const rows = psql(urlFor(DEST), "SELECT count(*) FROM blocks;");

    // Rejected while reading the manifest, long before the target is touched.
    const incomplete = join(out, "unrestorable.dump");
    writeFileSync(incomplete, readFileSync(archive));
    const meta = readManifest(archive);
    const { blocks: _dropped, ...rowCounts } = meta.rowCounts;
    writeManifest(incomplete, { ...meta, archive: basename(incomplete), rowCounts });

    const failed = snapshot(["restore", incomplete], { SNAPSHOT_TARGET_URL: urlFor(DEST) });
    expect(failed.status).not.toBe(0);

    // The checksum, not merely the presence of a row: a marker naming the wrong
    // archive is worse than none, because the explorer would report it.
    expect(
      psql(
        urlFor(DEST),
        "SELECT archive_sha256 || '|' || captured_at FROM explorer_snapshot_meta;",
      ),
      "the failed archive's identity was written over the surviving snapshot",
    ).toBe(before);
    expect(psql(urlFor(DEST), "SELECT count(*) FROM blocks;")).toBe(rows);
  }, 180_000);
});
