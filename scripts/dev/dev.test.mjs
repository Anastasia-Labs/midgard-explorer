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

import { expand, isPlaceholder, parseEnvFile, redact, redactValue, urlTarget } from "./env.mjs";

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
const doctor = (root, mode) => {
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts", "dev", "doctor.mjs"), root, mode, "--json"],
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

    assert.equal(check(report, "existing.manifest-file").status, "fail");
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
