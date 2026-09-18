/**
 * Tests for the development commands' own logic.
 *
 * Run with Node's built-in runner, from this package:
 *
 *   pnpm test:dev
 *
 * Node's runner rather than Vitest, which this package uses for everything
 * else. These start processes, write throwaway repository roots and read
 * `/proc`, and they cover the scripts rather than the server, so they are kept
 * off the suite that shares one guarded test database. The Vitest config
 * collects `.test.mts` only, so this file is not picked up twice.
 *
 * They cover the parts that decide what a contributor is told: whether a
 * credential can reach the terminal, and whether each failure produces its own
 * diagnosis rather than a generic one.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  adoption,
  COMPOSE_SERVICES,
  composeArgs,
  clearAdoption,
  readAdoption,
  servicesToStop,
  START_WAIT_SECONDS,
  waitArgs,
  writeAdoption,
} from "../scripts/lib/compose.mjs";
import { REQUIRED_BACKEND_ENV } from "../scripts/lib/checks.mjs";
import { runChecks, summarise } from "../scripts/doctor.mjs";
import { descendants } from "../scripts/lib/proc.mjs";

import {
  backendSettings,
  expand,
  isPlaceholder,
  parseEnvFile,
  redact,
  redactValue,
  runtimeShellValues,
  urlTarget,
} from "../scripts/lib/env.mjs";

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
      [join(repoRoot, "backend", "scripts", "doctor.mjs"), root, mode, "--json", ...flags],
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
        MIDGARD_MANIFEST_PATH: "",
      }),
    ),
  );

  it("generates every setting doctor calls required", () => {
    for (const key of REQUIRED_BACKEND_ENV) {
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

describe("the setup sequence the README documents", () => {
  /* Run setup, fill in the node's database, run setup again. That is the whole
   * instruction in backend/README.md, and it did not work: an empty value in
   * .dev/runtime.env counted as an answer, so the second run overwrote what had
   * just been typed and asked for it again. */
  const setup = (root) =>
    execFileSync(
      process.execPath,
      [join(repoRoot, "backend", "scripts", "setup.mjs"), root, "existing"],
      { encoding: "utf8", timeout: 120_000 },
    );

  const backendEnv = (root) => expand(parseEnvFile(join(root, "backend", ".env")));

  it("carries the values a person filled in, on the second run", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "backend"), { recursive: true });
    mkdirSync(join(root, "frontend-new", "app"), { recursive: true });

    const first = setup(root);
    assert.match(first, /Still needed/);
    assert.equal(backendEnv(root).get("POSTGRES_HOST"), "");

    // What the README tells the reader to do.
    const filled = readFileSync(join(root, "backend", ".env"), "utf8")
      .replace("POSTGRES_HOST=", "POSTGRES_HOST=db.example")
      .replace("POSTGRES_PORT=", "POSTGRES_PORT=5433")
      .replace("POSTGRES_USER=", "POSTGRES_USER=midgard")
      .replace("POSTGRES_PASSWORD=", "POSTGRES_PASSWORD=secret")
      .replace("POSTGRES_DB=", "POSTGRES_DB=midgard");
    writeFileSync(join(root, "backend", ".env"), filled);

    const second = setup(root);
    const env = backendEnv(root);
    assert.equal(env.get("POSTGRES_HOST"), "db.example");
    assert.equal(env.get("POSTGRES_DB"), "midgard");
    assert.match(env.get("POSTGRES_URL"), /db\.example:5433\/midgard/);
    assert.doesNotMatch(second, /Still needed/, "setup asked again for what was just filled in");
    assert.match(second, /Start it with: pnpm dev/);

    // And the runtime file it keeps in step now holds them too.
    const runtime = expand(parseEnvFile(join(root, ".dev", "runtime.env")));
    assert.equal(runtime.get("POSTGRES_HOST"), "db.example");
  });

  it("writes nothing outside the backend when scoped to it", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, "backend"), { recursive: true });
    mkdirSync(join(root, "frontend-new", "app"), { recursive: true });
    setup(root);
    assert.equal(existsSync(join(root, "frontend-new", "app", ".env.local")), false);
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
      }),
    );

  it("quotes a value that would otherwise be shell code", () => {
    const values = complete();
    values.set("MIDGARD_MANIFEST_PATH", "/tmp/a b/$(touch /tmp/pwned).json");
    const { lines } = runtimeShellValues(values);
    const line = lines.find((l) => l.startsWith("MIDGARD_MANIFEST_PATH="));
    assert.equal(line, "MIDGARD_MANIFEST_PATH='/tmp/a b/$(touch /tmp/pwned).json'");

    // And the quoting survives the shell that eventually reads it. The line is
    // passed as an argument, never spliced into the text of a command.
    assert.equal(evalled(line, "MIDGARD_MANIFEST_PATH"), "/tmp/a b/$(touch /tmp/pwned).json");
  });

  it("closes a value that tries to end its own quote", () => {
    const values = complete();
    values.set("EXPLORER_POSTGRES_DB", "a'; touch /tmp/pwned; '");
    const { lines } = runtimeShellValues(values);
    const line = lines.find((l) => l.startsWith("EXPLORER_POSTGRES_DB="));
    assert.equal(evalled(line, "EXPLORER_POSTGRES_DB"), "a'; touch /tmp/pwned; '");
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
    const { errors } = runtimeShellValues(values);
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.includes("BACKEND_PORT")));
    assert.ok(errors.some((e) => e.includes("FRONTEND_PORT")));
  });

  /* The retained explorer database's password is read by Compose through
   * --env-file, and by nothing else. A `dev` shell that only needs a port has
   * no reason to hold a credential, so the whitelist does not carry it. */
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

describe("what starting a service waits for", () => {
  /* A hosted run failed one line after "explorer-postgres is up": `up -d`
   * returns once the container has been CREATED, and the next step connected to
   * a Postgres that was still starting. P1001, can't reach the database server.
   * Locally the race is won nearly every time, which is what kept it invisible
   * through every green run before it. That database is decommissioned; the
   * rule it taught applies to whatever a caller starts next. */
  it("waits for the healthcheck, not for docker to accept the request", () => {
    assert.ok(
      waitArgs("explorer-api-cache").includes("--wait"),
      "a start does not wait for health",
    );
  });

  /* Compose waits forever without one, so the process timeout would kill it
   * with no word about which service never came up. */
  it("bounds the wait, so a container that never comes up is named", () => {
    const args = waitArgs("explorer-api-cache");
    const at = args.indexOf("--wait-timeout");
    assert.notEqual(at, -1, "the wait has no timeout");
    assert.equal(args[at + 1], String(START_WAIT_SECONDS));
  });

  /* `--wait` waits for every service named in the command, so a caller that
   * listed two would turn one unhealthy service into a refusal to start at
   * all. One is running unhealthy on the machine this was written on. */
  it("waits for the one service it was given", () => {
    const args = waitArgs("explorer-api-cache");
    assert.equal(args.at(-1), "explorer-api-cache");
    assert.equal(args.filter((a) => a.startsWith("explorer-")).length, 1);
  });
});

describe("which containers a stop may touch", () => {
  /* The rule lives in backend/scripts/lib/compose.mjs. What it must never do
   * is call a container this command started adopted, because a stop then
   * leaves running exactly what the start had started. */
  // Two names, because the rule is about a set. `adoption` is a pure function
  // over whatever it is handed; the repository's own set is COMPOSE_SERVICES.
  const both = ["service-a", "service-b"];

  it("adopts what was already running the first time", () => {
    assert.deepEqual(adoption(false, [], both), both);
    assert.deepEqual(adoption(false, [], ["service-b"]), ["service-b"]);
    assert.deepEqual(adoption(false, [], []), []);
  });

  it("keeps what dev started after a restart", () => {
    assert.deepEqual(adoption(true, [], both), []);
  });

  it("keeps an adopted container adopted after a restart", () => {
    assert.deepEqual(adoption(true, ["service-b"], both), ["service-b"]);
  });

  it("stops everything it is not leaving alone, and nothing else", () => {
    assert.deepEqual(servicesToStop([], both), both);
    assert.deepEqual(servicesToStop(["service-b"], both), ["service-a"]);
    assert.deepEqual(servicesToStop(both, both), []);
  });

  /* The retained explorer database is not in the set, so no development
   * command can start it and no stop can touch it. It is kept, stopped, for a
   * rollback that a person performs deliberately. */
  it("does not manage the decommissioned explorer database", () => {
    assert.ok(!COMPOSE_SERVICES.includes("explorer-postgres"));
    assert.deepEqual(servicesToStop([]), [...COMPOSE_SERVICES]);
  });

  /* The project is named by the root that was asked about. Passing only
   * --env-file let docker resolve the compose file from the working directory,
   * so a command aimed at one checkout could stop another's containers. */
  it("names the project by the root it was given", () => {
    const args = composeArgs("/some/root", ["ps"]);
    assert.deepEqual(args.slice(0, 6), [
      "compose",
      "--project-directory",
      "/some/root",
      "-f",
      "/some/root/docker-compose.yml",
      "--env-file",
    ]);
    assert.equal(args.at(-1), "ps");
  });

  it("treats a missing record as nothing having been started", () => {
    const root = fixtureRoot();
    assert.equal(readAdoption(root), null);
  });

  it("round-trips the record it writes", () => {
    const root = fixtureRoot();
    writeAdoption(root, ["explorer-api-cache"]);
    assert.deepEqual(readAdoption(root), ["explorer-api-cache"]);
    clearAdoption(root);
    assert.equal(readAdoption(root), null);
  });
});

/* Generated inputs for the four decisions that can lose data or leak a
 * credential. These are properties rather than examples: a table of cases only
 * ever covers what somebody thought of, and the failures worth finding here are
 * the strings and orderings nobody would write down. The generator is seeded,
 * so a failure names the input that produced it and can be replayed. */
const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const AWKWARD = [
  "", " ", "'", "''", "\\", '"', "$", "`", "$(touch /tmp/pwned)", "${HOME}",
  "a b", "a\nb", "a;b", "a|b", "a&b", "*", "?", "~", "--flag", "-", "\t",
  "'; rm -rf /; '", "\u00e9\u00fc\u00f1", "\u0000nul",
];

const randomString = (random) => {
  if (random() < 0.6) return AWKWARD[Math.floor(random() * AWKWARD.length)];
  const alphabet = "abcXYZ019 '\"\\$`;|&*?()[]{}<>\n\t~!#%^-_=+/:,.@";
  const length = Math.floor(random() * 12);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
};

describe("properties of the decisions that can lose data", () => {
  it("a quoted value survives the shell unchanged, whatever is in it", () => {
    const random = seeded(20260902);
    for (let run = 0; run < 300; run += 1) {
      const value = randomString(random);
      // A NUL cannot survive a process argument, and no configuration holds one.
      if (value.includes("\u0000")) continue;
      const values = new Map(
        Object.entries({
          BACKEND_PORT: "3101",
          API_CACHE_PORT: "3102",
          FRONTEND_PORT: "3011",
          MIDGARD_MANIFEST_PATH: value,
        }),
      );
      const { lines } = runtimeShellValues(values);
      const line = lines.find((entry) => entry.startsWith("MIDGARD_MANIFEST_PATH="));
      if (value === "") {
        assert.equal(line, undefined, "an empty value is absent, not emitted");
        continue;
      }
      assert.equal(
        evalled(line, "MIDGARD_MANIFEST_PATH"),
        value,
        `the shell changed ${JSON.stringify(value)}`,
      );
    }
  });

  it("never emits a credential, whatever the password looks like", () => {
    const random = seeded(7);
    for (let run = 0; run < 200; run += 1) {
      /* Distinctive by construction. A one-character secret like "=" occurs
       * in every KEY=value line by coincidence, so the assertion would fail on
       * the shape of the output rather than on a leak. A real password is long
       * enough not to appear by accident, and the marker makes that explicit. */
      const secret = `pw-${randomString(random).replace(/[\u0000\n@/:]/g, "x")}-${run}-marker`;
      const values = new Map(
        Object.entries({
          BACKEND_PORT: "3101",
          API_CACHE_PORT: "3102",
          FRONTEND_PORT: "3011",
          EXPLORER_POSTGRES_PASSWORD: secret,
        }),
      );
      const { lines } = runtimeShellValues(values);
      assert.ok(
        !lines.join("\n").includes(secret),
        `the password ${JSON.stringify(secret)} reached the shell`,
      );
    }
  });

  it("adopted and stopped never overlap, and together cover what it manages", () => {
    const random = seeded(99);
    const universe = ["service-a", "service-b"];
    for (let run = 0; run < 300; run += 1) {
      const running = universe.filter(() => random() < 0.5);
      const previous = universe.filter(() => random() < 0.5);
      const had = random() < 0.5;
      const managed = random() < 0.5 ? universe : ["service-b"];

      const adopted = adoption(had, previous, running.filter((s) => managed.includes(s)));
      const stopped = servicesToStop(adopted, managed);

      for (const service of adopted) {
        assert.ok(!stopped.includes(service), `${service} was both adopted and stopped`);
        assert.ok(managed.includes(service), `${service} is not this caller's to adopt`);
      }
      for (const service of stopped) {
        assert.ok(managed.includes(service), `${service} is not this caller's to stop`);
      }
      assert.deepEqual(
        [...adopted, ...stopped].sort(),
        [...managed].sort(),
        "every managed service is either left alone or stopped, never neither",
      );
    }
  });

});

describe("stopping the API stops what it started", () => {
  /* `pnpm dev` runs the server through pnpm, which runs it through a shell and
   * does not pass a signal on to it. The command therefore signals by descent,
   * and this is the walk it signals by: a tree it cannot see is a server that
   * keeps the port after the command has returned. */
  it("finds a process under two intermediate shells", async () => {
    const tree = spawn("sh", ["-c", 'sh -c "sleep 30" & wait'], { stdio: "ignore" });
    try {
      let found = [];
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && found.length < 3) {
        found = descendants(tree.pid);
        if (found.length < 3) await new Promise((wait) => setTimeout(wait, 50));
      }
      assert.equal(found[0], tree.pid, "the root is listed first");
      assert.ok(found.length >= 3, `expected the root and two below it, got ${found.length}`);
      assert.equal(new Set(found).size, found.length, "no pid is listed twice");

      for (const pid of found.reverse()) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
      await new Promise((closed) => tree.on("close", closed));
      assert.deepEqual(descendants(tree.pid), [tree.pid], "nothing survived the walk");
    } finally {
      try {
        process.kill(tree.pid, "SIGKILL");
      } catch {
        // Already stopped.
      }
    }
  });

  it("answers for a pid that is not there", () => {
    assert.deepEqual(descendants(2 ** 30), [2 ** 30]);
  });
});

describe("doctor", () => {
  it("warns about an absent manifest and fails on one that is not there", () => {
    const base = [
      "BACKEND_PORT=3101",
      "LOG_LOCATION=./logs/x",
      "POSTGRES_URL=postgresql://u:p@127.0.0.1:5433/midgard",
      "RECENT_BLOCKS_LIMIT=10",
      "RECENT_TRANSACTIONS_LIMIT=10",
      "TRANSACTIONS_PER_PAGE=25",
      "BLOCKS_PER_PAGE=25",
    ];

    // Absent: the backend boots, and every response is attributed to no
    // deployment, which readiness refuses. A warning, not a failure.
    const absent = doctor(
      fixtureRoot({ "backend/.env": [...base, "MIDGARD_MANIFEST_PATH="].join("\n") }),
      "existing",
    ).report;
    assert.equal(check(absent, "backend.env-complete").status, "pass");
    assert.equal(check(absent, "existing.manifest-file").status, "warn");

    // Set and not there: a configuration mistake the backend refuses to boot on.
    const missing = doctor(
      fixtureRoot({
        "backend/.env": [...base, "MIDGARD_MANIFEST_PATH=/tmp/not-a-manifest.json"].join("\n"),
      }),
      "existing",
    ).report;
    assert.equal(check(missing, "existing.manifest-file").status, "fail");
  });

  it("exits 2 on an unknown mode", () => {
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [join(repoRoot, "backend", "scripts", "doctor.mjs"), repoRoot, "nonsense"],
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
        "MIDGARD_MANIFEST_PATH=/abs/path/to/contract-deployment-info.json",
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

    // A failure, because the placeholder path is non-empty, so only the
    // does-the-file-exist check catches it.
    assert.equal(check(report, "existing.manifest-file").status, "fail");
  });

  it("never lets a password reach the report", () => {
    const secret = "pw-must-not-appear-8fa31c";
    const root = fixtureRoot({
      "backend/.env": [
        "BACKEND_PORT=3101",
        "LOG_LOCATION=./logs/x",
        `POSTGRES_URL=postgresql://u:${secret}@127.0.0.1:59999/midgard`,
        "MIDGARD_MANIFEST_PATH=/tmp/none.json",
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
