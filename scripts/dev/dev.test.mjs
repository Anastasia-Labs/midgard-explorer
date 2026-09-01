/**
 * Tests for the `dev` command's own logic.
 *
 * Run with Node's built-in runner, from the repository root:
 *
 *   node --test scripts/dev/
 *
 * No test framework and no package.json, because ADR 1 records that this
 * repository has no root workspace and this directory is not worth creating one
 * for. The runner ships with the Node version the repository already requires.
 *
 * These cover the parts that decide what a contributor is told: whether a
 * credential can reach the terminal, and whether each failure produces its own
 * diagnosis rather than a generic one.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { REQUIRED_BACKEND_ENV, REQUIRED_WHEN_INDEXING } from "./checks.mjs";
import { runChecks, summarise } from "./doctor.mjs";

import {
  backendSettings,
  expand,
  isPlaceholder,
  parseEnvFile,
  redact,
  redactValue,
  runtimeShellValues,
  urlTarget,
} from "./env.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots = [];

/** A throwaway repository root holding only what a check reads. */
const fixtureRoot = (files = {}) => {
  const root = mkdtempSync(join(tmpdir(), "dev-test-"));
  roots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
};

/** Doctor's machine-readable output for one mode. */
const doctor = (root, mode, ...flags) => {
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "dev", "doctor.mjs"), root, mode, "--json", ...flags],
      { encoding: "utf8", timeout: 120_000 },
    );
    return { code: 0, report: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.status, report: JSON.parse(String(error.stdout || "{}")) };
  }
};

const check = (report, id) => report.checks.find((c) => c.id === id);

after(() => {
  for (const root of roots) {
    try {
      execFileSync("rm", ["-rf", root]);
    } catch {
      // A leftover temporary directory is not worth failing a test run over.
    }
  }
});

describe("redaction", () => {
  it("removes the password from a connection string", () => {
    assert.equal(
      redact("postgresql://explorer:hunter2@localhost:5435/midgard_explorer"),
      "postgresql://explorer:***@localhost:5435/midgard_explorer",
    );
  });

  it("removes it from every URL in a sentence, not only the first", () => {
    const out = redact("tried postgres://a:secret1@h/db then postgresql://b:secret2@i/db");
    assert.ok(!out.includes("secret1"));
    assert.ok(!out.includes("secret2"));
  });

  it("hides a secret-named setting whatever its value looks like", () => {
    assert.equal(redactValue("POSTGRES_PASSWORD", "hunter2"), "***");
    assert.equal(redactValue("WALLET_SEED_PHRASE", "one two three"), "***");
    assert.equal(redactValue("BACKEND_PORT", "3101"), "3101");
  });
});

describe("env parsing", () => {
  it("resolves values composed from other values", () => {
    const root = fixtureRoot({
      ".env": 'A=one\nB="two"\nC=${A}-${B}\n# comment\nBAD LINE\n',
    });
    const values = expand(parseEnvFile(join(root, ".env")));
    assert.equal(values.get("C"), "one-two");
    assert.equal(values.get("B"), "two");
  });

  it("recognises the placeholders the shipped example carries", () => {
    assert.ok(isPlaceholder("postgresql://explorer:CHANGEME@localhost:5435/x"));
    assert.ok(isPlaceholder("/abs/path/to/contract-deployment-info.json"));
    assert.ok(!isPlaceholder("postgresql://explorer:real@localhost:5435/x"));
  });

  it("reads host, port and database without the credentials", () => {
    const target = urlTarget("postgresql://u:p@db.example:6543/thing");
    assert.deepEqual(target, { host: "db.example", port: 6543, database: "thing" });
  });
});

/** What a shell ends up holding after reading one generated assignment. */
const evalled = (line, key) =>
  execFileSync("bash", ["-c", `eval "$1"; printf %s "$${key}"`, "bash", line], {
    encoding: "utf8",
  });

describe("what setup generates and what doctor requires", () => {
  /* These went out of step once: the backend declared two settings with no
   * default, setup wrote neither, and doctor asked for neither, so a clean
   * setup reported Ready and then refused to boot. One test holds them
   * together in both directions. */
  const generated = backendSettings(
    new Map(
      Object.entries({
        BACKEND_PORT: "3101",
        POSTGRES_HOST: "localhost",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "u",
        POSTGRES_PASSWORD: "p",
        POSTGRES_DB: "midgard",
        INDEXER_POSTGRES_URL: "postgresql://explorer:p@127.0.0.1:5435/midgard_explorer",
        TEST_INDEXER_POSTGRES_URL: "postgresql://explorer:p@127.0.0.1:5435/midgard_explorer_test",
        MIDGARD_MANIFEST_PATH: "",
        KOIOS_BASE_URL: "https://preprod.koios.rest/api/v1",
        L1_SYNC_INTERVAL_MS: "60000",
        L1_REORG_LOOKBACK_BLOCKS: "20",
      }),
    ),
  );

  it("generates every setting doctor calls required", () => {
    for (const key of [...REQUIRED_BACKEND_ENV, ...REQUIRED_WHEN_INDEXING]) {
      assert.ok(generated.has(key), `setup does not generate ${key}, which doctor requires`);
    }
  });

  it("gives every one of them a value, not an empty line", () => {
    for (const key of REQUIRED_BACKEND_ENV) {
      assert.notEqual(generated.get(key), "", `setup writes ${key} empty`);
      assert.notEqual(generated.get(key), undefined, `setup writes ${key} as undefined`);
    }
  });
});

describe("runtime.env reaches the shell as data", () => {
  const complete = () =>
    new Map(
      Object.entries({
        BACKEND_PORT: "3101",
        API_CACHE_PORT: "3102",
        FRONTEND_PORT: "3011",
        BIND_HOST: "127.0.0.1",
        EXPLORER_POSTGRES_USER: "explorer",
        EXPLORER_POSTGRES_DB: "midgard_explorer",
        INDEXER_POSTGRES_URL: "postgresql://explorer:pw@127.0.0.1:5435/midgard_explorer",
      }),
    );

  it("emits the index target without the password that reaches it", () => {
    const { errors, lines } = runtimeShellValues(complete());
    assert.deepEqual(errors, []);
    assert.ok(lines.includes("INDEX_URL_HOST='127.0.0.1'"));
    assert.ok(lines.includes("INDEX_URL_PORT='5435'"));
    assert.ok(lines.includes("INDEX_URL_DB='midgard_explorer'"));
    assert.ok(!lines.join("\n").includes("pw"), "the index password reached the shell");
  });

  it("quotes a value that would otherwise be shell code", () => {
    const values = complete();
    values.set("MIDGARD_MANIFEST_PATH", "/tmp/a b/$(touch /tmp/pwned).json");
    const { lines } = runtimeShellValues(values);
    const line = lines.find((l) => l.startsWith("MIDGARD_MANIFEST_PATH="));
    assert.equal(line, "MIDGARD_MANIFEST_PATH='/tmp/a b/$(touch /tmp/pwned).json'");

    // And the quoting survives the shell that eventually reads it. The line is
    // passed as an argument, which is how existing.sh reaches `eval`: through a
    // variable, never spliced into the text of a command.
    assert.equal(evalled(line, "MIDGARD_MANIFEST_PATH"), "/tmp/a b/$(touch /tmp/pwned).json");
  });

  it("closes a value that tries to end its own quote", () => {
    const values = complete();
    values.set("EXPLORER_POSTGRES_DB", "a'; touch /tmp/pwned; '");
    const { lines } = runtimeShellValues(values);
    const line = lines.find((l) => l.startsWith("EXPLORER_POSTGRES_DB="));
    assert.equal(evalled(line, "EXPLORER_POSTGRES_DB"), "a'; touch /tmp/pwned; '");
  });

  /* The target is whatever the backend and `prisma migrate deploy` will read,
   * which is the process environment first and backend/.env second. Reading
   * .dev/runtime.env instead let a safe-looking runtime file stand in front of
   * a remote backend/.env, and the remote database was the one migrated. */
  it("takes the index target from backend/.env, not from runtime.env", () => {
    const backendEnv = new Map([
      ["INDEXER_POSTGRES_URL", "postgresql://admin:pw@db.internal.example:6543/production_index"],
    ]);
    const { lines } = runtimeShellValues(complete(), { backendEnv });
    assert.ok(lines.includes("INDEX_URL_HOST='db.internal.example'"));
    assert.ok(lines.includes("INDEX_URL_PORT='6543'"));
    assert.ok(lines.includes("INDEX_URL_DB='production_index'"));
    assert.ok(lines.includes("INDEX_URL_SOURCE='backend/.env'"));
  });

  it("lets the process environment win, because dotenv does", () => {
    const backendEnv = new Map([
      ["INDEXER_POSTGRES_URL", "postgresql://explorer:pw@127.0.0.1:5435/midgard_explorer"],
    ]);
    const processEnv = {
      INDEXER_POSTGRES_URL: "postgresql://admin:pw@db.internal.example:6543/production_index",
    };
    const { lines } = runtimeShellValues(complete(), { backendEnv, processEnv });
    assert.ok(lines.includes("INDEX_URL_HOST='db.internal.example'"));
    assert.ok(lines.includes("INDEX_URL_SOURCE='the INDEXER_POSTGRES_URL in this environment'"));
  });

  it("accepts a local IPv6 host and refuses a port that does not exist", () => {
    const values = complete();
    values.set("EXPLORER_POSTGRES_HOST", "::1");
    values.set("BACKEND_PORT", "99999");
    const { errors, lines } = runtimeShellValues(values);
    assert.ok(lines.includes("EXPLORER_POSTGRES_HOST='::1'"));
    assert.ok(errors.some((e) => e.includes("BACKEND_PORT")));
  });

  it("names every setting it cannot use rather than the first", () => {
    const values = complete();
    values.set("BACKEND_PORT", "not-a-port");
    values.delete("FRONTEND_PORT");
    values.delete("INDEXER_POSTGRES_URL");
    const { errors } = runtimeShellValues(values, { processEnv: {} });
    assert.equal(errors.length, 3);
    assert.ok(errors.some((e) => e.includes("BACKEND_PORT")));
    assert.ok(errors.some((e) => e.includes("FRONTEND_PORT")));
    assert.ok(errors.some((e) => e.includes("INDEXER_POSTGRES_URL")));
  });

  it("does not carry the explorer password into the shell at all", () => {
    const values = complete();
    values.set("EXPLORER_POSTGRES_PASSWORD", "must-not-appear-4c1f");
    const { lines } = runtimeShellValues(values);
    assert.ok(!lines.join("\n").includes("must-not-appear-4c1f"));
  });
});

describe("a check that cannot run", () => {
  const broken = {
    id: "broken.check",
    title: "A check with a defect in it",
    modes: ["demo"],
    run: async () => {
      throw new TypeError("cannot read properties of undefined");
    },
  };
  const healthy = {
    id: "healthy.check",
    title: "A check that answers",
    modes: ["demo"],
    run: async () => ({ status: "pass", detail: "fine" }),
  };

  it("is reported as an error rather than as a skip", async () => {
    const [result] = await runChecks({ repoRoot: "/nowhere", mode: "demo" }, [broken]);
    assert.equal(result.status, "error");
    assert.match(result.detail, /cannot read properties of undefined/);
    assert.ok(result.hint.length > 0);
  });

  it("withholds Ready, which a skip did not", async () => {
    const results = await runChecks({ repoRoot: "/nowhere", mode: "demo" }, [healthy, broken]);
    const { summary, failed } = summarise(results);
    assert.equal(summary.pass, 1);
    assert.equal(summary.error, 1);
    assert.equal(summary.fail, 0);
    assert.equal(failed, true, "a run holding a check nobody could run called itself ready");
  });

  it("does not stop the checks after it from running", async () => {
    const results = await runChecks({ repoRoot: "/nowhere", mode: "demo" }, [broken, healthy]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["error", "pass"],
    );
  });
});

describe("which containers a stop may touch", () => {
  /* The rule lives in existing.sh, so it is exercised there rather than
   * restated here. What it must never do is call a container `dev` started
   * adopted, because `down` then leaves running exactly what `up` started. */
  const adoption = (had, previous, running) =>
    execFileSync(
      "bash",
      [
        "-c",
        `source "${join(repoRoot, "scripts", "dev", "existing.sh")}" 2>/dev/null || true
         existing_adoption "$1" "$2" "$3"`,
        "bash",
        String(had),
        previous,
        running,
      ],
      { encoding: "utf8" },
    );

  const stops = (adopted) =>
    execFileSync(
      "bash",
      [
        "-c",
        `source "${join(repoRoot, "scripts", "dev", "existing.sh")}" 2>/dev/null || true
         existing_services_to_stop "$1" explorer-postgres explorer-api-cache`,
        "bash",
        adopted,
      ],
      { encoding: "utf8" },
    );

  const both = "explorer-postgres explorer-api-cache";

  /* What `down` does after each way `up` can end, including the ways it can
   * fail. The record is written before `compose up -d`, so its absence means
   * nothing was started and nothing may be stopped. */
  const downStops = (record) =>
    execFileSync(
      "bash",
      [
        "-c",
        `set -uo pipefail
         source "${join(repoRoot, "scripts", "dev", "lib.sh")}"
         source "${join(repoRoot, "scripts", "dev", "demo.sh")}"
         source "${join(repoRoot, "scripts", "dev", "existing.sh")}"
         ROOT="$(mktemp -d)"
         DEV_STATE_ROOT="$ROOT"
         DEV_MODE_STATE_EXISTING="$ROOT/existing"
         mkdir -p "$DEV_MODE_STATE_EXISTING"
         : >"$ROOT/runtime.env"
         existing_compose() { :; }
         existing_stop_processes() { :; }
         [ "$1" = "none" ] || printf '%s' "$2" >"$DEV_MODE_STATE_EXISTING/adopted"
         existing_down 2>&1 | grep -E "stopped:|none are stopped" || true
         rm -rf "$ROOT"`,
        "bash",
        record === null ? "none" : "some",
        record ?? "",
      ],
      { encoding: "utf8" },
    ).trim();

  it("stops nothing when up never got as far as starting a container", () => {
    assert.match(downStops(null), /none are stopped/);
  });

  it("stops only what it started when up failed part-way", () => {
    assert.equal(downStops("explorer-api-cache"), "stopped: explorer-postgres");
    assert.equal(downStops(""), `stopped: ${both}`);
  });

  it("stops everything it is not leaving alone, and nothing else", () => {
    assert.equal(stops(""), both);
    assert.equal(stops("explorer-api-cache"), "explorer-postgres");
    assert.equal(stops(both), "");
  });

  it("adopts what was already running the first time", () => {
    assert.equal(adoption(0, "", both), both);
    assert.equal(adoption(0, "", "explorer-api-cache"), "explorer-api-cache");
    assert.equal(adoption(0, "", ""), "");
  });

  it("keeps what dev started after a restart", () => {
    assert.equal(adoption(1, "", both), "");
  });

  it("keeps an adopted container adopted after a restart", () => {
    assert.equal(adoption(1, "explorer-api-cache", both), "explorer-api-cache");
  });
});

describe("which question doctor answers about existing mode", () => {
  /* `up existing --with-l1-sync` sets L1_SYNC_ENABLED for the backend process
   * only, so backend/.env still reads false while an indexer is running. Doctor
   * used to believe the file, run the L2 scope, and answer Ready for a system
   * whose reconciliation had just failed. It was also the command the timeout
   * message told the reader to run. */
  const l2Only = () =>
    fixtureRoot({
      "backend/.env": [
        "BACKEND_PORT=3101",
        "LOG_LOCATION=./logs/x",
        "POSTGRES_URL=postgresql://u:p@127.0.0.1:5433/midgard",
        "INDEXER_POSTGRES_URL=postgresql://explorer:p@127.0.0.1:5435/midgard_explorer",
        "TEST_INDEXER_POSTGRES_URL=postgresql://explorer:p@127.0.0.1:5435/midgard_explorer_test",
        "MIDGARD_MANIFEST_PATH=",
        "KOIOS_BASE_URL=https://preprod.koios.rest/api/v1",
        "RECENT_BLOCKS_LIMIT=10",
        "RECENT_TRANSACTIONS_LIMIT=10",
        "TRANSACTIONS_PER_PAGE=25",
        "BLOCKS_PER_PAGE=25",
        "L1_SYNC_ENABLED=false",
        "L1_SYNC_INTERVAL_MS=60000",
        "L1_REORG_LOOKBACK_BLOCKS=20",
      ].join("\n"),
    });

  const manifest = (report) => check(report, "existing.manifest-file").status;

  it("asks the narrow question when nothing says otherwise", () => {
    assert.equal(manifest(doctor(l2Only(), "existing").report), "warn");
  });

  it("asks the wider one when the flag is given", () => {
    assert.equal(manifest(doctor(l2Only(), "existing", "--with-l1-sync").report), "fail");
  });

  it("asks the wider one when a run is up with the indexer on", () => {
    const root = l2Only();
    mkdirSync(join(root, ".dev", "existing"), { recursive: true });
    writeFileSync(
      join(root, ".dev", "existing", "state.env"),
      "EXISTING_APP_URL='http://127.0.0.1:3011'\nEXISTING_WITH_L1_SYNC='1'\n",
    );
    assert.equal(manifest(doctor(root, "existing").report), "fail");
  });
});

describe("doctor", () => {
  it("exits 2 on an unknown mode", () => {
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [join(repoRoot, "scripts", "dev", "doctor.mjs"), repoRoot, "nonsense"],
        { stdio: "pipe" },
      );
    } catch (error) {
      status = error.status;
    }
    assert.equal(status, 2);
  });

  it("names every check with a stable, well-formed id", () => {
    const { report } = doctor(fixtureRoot(), "demo");
    for (const one of report.checks) {
      assert.match(one.id, /^[a-z0-9]+(\.[a-z0-9-]+)+$/);
    }
    assert.equal(new Set(report.checks.map((c) => c.id)).size, report.checks.length);
  });

  it("says a mode that is not built is not built", () => {
    assert.equal(doctor(fixtureRoot(), "full").report.modeBuilt, false);
    assert.equal(doctor(fixtureRoot(), "demo").report.modeBuilt, true);
  });

  it("fails, rather than skipping, when nothing is configured", () => {
    const { code, report } = doctor(fixtureRoot(), "existing");
    assert.equal(code, 1);
    assert.equal(check(report, "backend.env-file").status, "fail");
    // A skip has to say why it skipped, or it reads as a pass.
    for (const one of report.checks.filter((c) => c.status === "skip")) {
      assert.ok(one.detail.length > 0, `${one.id} skipped without a reason`);
    }
    // And a readiness probe that could not run is never one of them: skips do
    // not set the exit code, so a probe nobody ran would have counted as fine.
    for (const one of report.checks.filter((c) => c.id.startsWith("readiness."))) {
      assert.equal(one.status, "fail", `${one.id} did not run and did not fail`);
      assert.match(one.detail, /could not run the readiness probe/);
    }
  });

  it("catches a .env copied from the example and not filled in", () => {
    const root = fixtureRoot({
      "backend/.env": [
        "BACKEND_PORT=3101",
        "LOG_LOCATION=./logs/x",
        "POSTGRES_USER=",
        "POSTGRES_PASSWORD=",
        "POSTGRES_HOST=localhost",
        "POSTGRES_PORT=5433",
        "POSTGRES_DB=",
        "POSTGRES_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}",
        "INDEXER_POSTGRES_URL=postgresql://explorer:CHANGEME@localhost:5435/midgard_explorer",
        "TEST_INDEXER_POSTGRES_URL=postgresql://explorer:CHANGEME@localhost:5435/midgard_explorer_test",
        "MIDGARD_MANIFEST_PATH=/abs/path/to/contract-deployment-info.json",
        "KOIOS_BASE_URL=https://preprod.koios.rest/api/v1",
        "RECENT_BLOCKS_LIMIT=10",
        "RECENT_TRANSACTIONS_LIMIT=10",
        "TRANSACTIONS_PER_PAGE=25",
        "BLOCKS_PER_PAGE=25",
        "L1_SYNC_INTERVAL_MS=60000",
        "L1_REORG_LOOKBACK_BLOCKS=20",
      ].join("\n"),
    });
    const { report } = doctor(root, "existing");

    // The composed URL is a non-empty string built from empty parts, so the
    // "is it set" check passes and only the shape check catches it.
    assert.equal(check(report, "backend.env-complete").status, "pass");
    assert.equal(check(report, "backend.env-url-parts").status, "fail");
    assert.match(check(report, "backend.env-url-parts").detail, /names no user/);

    assert.equal(check(report, "backend.env-placeholders").status, "fail");
    assert.match(check(report, "backend.env-placeholders").detail, /MIDGARD_MANIFEST_PATH/);

    // A failure, because this .env names no L1_SYNC_ENABLED and the backend's
    // default is to index. The placeholder path is non-empty, so only the
    // does-the-file-exist check catches it.
    assert.equal(check(report, "existing.manifest-file").status, "fail");
  });

  it("requires the manifest of an explorer that indexes, and not of one that does not", () => {
    const base = [
      "BACKEND_PORT=3101",
      "LOG_LOCATION=./logs/x",
      "POSTGRES_URL=postgresql://u:p@127.0.0.1:5433/midgard",
      "INDEXER_POSTGRES_URL=postgresql://explorer:p@127.0.0.1:5435/midgard_explorer",
      "TEST_INDEXER_POSTGRES_URL=postgresql://explorer:p@127.0.0.1:5435/midgard_explorer_test",
      "MIDGARD_MANIFEST_PATH=",
      "KOIOS_BASE_URL=https://preprod.koios.rest/api/v1",
      "RECENT_BLOCKS_LIMIT=10",
      "RECENT_TRANSACTIONS_LIMIT=10",
      "TRANSACTIONS_PER_PAGE=25",
      "BLOCKS_PER_PAGE=25",
      "L1_SYNC_INTERVAL_MS=60000",
      "L1_REORG_LOOKBACK_BLOCKS=20",
    ];

    const reading = doctor(
      fixtureRoot({ "backend/.env": [...base, "L1_SYNC_ENABLED=false"].join("\n") }),
      "existing",
    ).report;
    assert.equal(check(reading, "backend.env-complete").status, "pass");
    assert.equal(check(reading, "existing.manifest-file").status, "warn");

    const indexing = doctor(
      fixtureRoot({ "backend/.env": [...base, "L1_SYNC_ENABLED=true"].join("\n") }),
      "existing",
    ).report;
    assert.equal(check(indexing, "backend.env-complete").status, "fail");
    assert.match(check(indexing, "backend.env-complete").detail, /MIDGARD_MANIFEST_PATH/);
    assert.equal(check(indexing, "existing.manifest-file").status, "fail");
  });

  it("refuses a test database that is the index, or is not named for the job", () => {
    const base = (test) =>
      [
        "BACKEND_PORT=3101",
        "LOG_LOCATION=./logs/x",
        "POSTGRES_URL=postgresql://u:p@127.0.0.1:5433/midgard",
        "INDEXER_POSTGRES_URL=postgresql://explorer:p@127.0.0.1:5435/midgard_explorer",
        `TEST_INDEXER_POSTGRES_URL=${test}`,
        "MIDGARD_MANIFEST_PATH=/tmp/none.json",
        "KOIOS_BASE_URL=https://preprod.koios.rest/api/v1",
        "RECENT_BLOCKS_LIMIT=10",
        "RECENT_TRANSACTIONS_LIMIT=10",
        "TRANSACTIONS_PER_PAGE=25",
        "BLOCKS_PER_PAGE=25",
        "L1_SYNC_INTERVAL_MS=60000",
        "L1_REORG_LOOKBACK_BLOCKS=20",
      ].join("\n");

    const wrongName = doctor(
      fixtureRoot({
        "backend/.env": base("postgresql://explorer:p@127.0.0.1:5435/midgard_explorer"),
      }),
      "existing",
    ).report;
    assert.equal(check(wrongName, "existing.test-db-distinct").status, "fail");
    assert.match(check(wrongName, "existing.test-db-distinct").detail, /_test/);
  });

  it("never lets a password reach the report", () => {
    const secret = "pw-must-not-appear-8fa31c";
    const root = fixtureRoot({
      "backend/.env": [
        "BACKEND_PORT=3101",
        "LOG_LOCATION=./logs/x",
        `POSTGRES_URL=postgresql://u:${secret}@127.0.0.1:59999/midgard`,
        `INDEXER_POSTGRES_URL=postgresql://explorer:${secret}@127.0.0.1:59998/midgard_explorer`,
        `TEST_INDEXER_POSTGRES_URL=postgresql://explorer:${secret}@127.0.0.1:59998/midgard_explorer_test`,
        "MIDGARD_MANIFEST_PATH=/tmp/none.json",
        "KOIOS_BASE_URL=https://preprod.koios.rest/api/v1",
        "RECENT_BLOCKS_LIMIT=10",
        "RECENT_TRANSACTIONS_LIMIT=10",
        "TRANSACTIONS_PER_PAGE=25",
        "BLOCKS_PER_PAGE=25",
        "L1_SYNC_INTERVAL_MS=60000",
        "L1_REORG_LOOKBACK_BLOCKS=20",
      ].join("\n"),
    });
    const { report } = doctor(root, "existing");
    assert.ok(
      !JSON.stringify(report).includes(secret),
      "a password reached the doctor report",
    );
    // And the failure it reports is still specific enough to act on.
    assert.equal(check(report, "existing.node-db-reachable").status, "fail");
    assert.match(check(report, "existing.node-db-reachable").detail, /127\.0\.0\.1:59999/);
  });
});
