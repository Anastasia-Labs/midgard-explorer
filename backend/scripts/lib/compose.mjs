/**
 * The containers the explorer owns, and the rules about touching them.
 *
 * One of them: the Nginx cache in front of the API. It is declared in the
 * repository's docker-compose.yml and configured from .dev/runtime.env.
 * Development starts it for nothing: the cache is part of the deployed shape,
 * and nothing about the API's meaning changes when it is absent.
 *
 * The PostgreSQL that held the explorer's own Cardano index is deliberately
 * not here. It is retained, stopped, with its volume, so the decommission can
 * be reversed, and a service this module names is a service a development
 * command may start or stop. Leaving it out is what keeps `pnpm dev` from
 * starting a database nothing reads.
 *
 * This module is the only implementation of two rules:
 *
 *   adoption    which containers a stop command may touch
 *   lifecycle   how they are started and stopped
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { expand, parseEnvFile } from "./env.mjs";

const run = promisify(execFile);

/** The services this repository defines. Named here rather than discovered, so
 * a service added to the Compose file for some other purpose is not swept into
 * the set a development command starts and stops. */
export const COMPOSE_SERVICES = ["explorer-api-cache"];

export const runtimePath = (repoRoot) => join(repoRoot, ".dev", "runtime.env");

/** The adoption record, per caller.
 *
 * Each caller keeps its own answer about what it found and what it owns, so a
 * command can never stop a container another one started. */
export const adoptedPath = (repoRoot, scope = "existing") =>
  join(repoRoot, ".dev", scope, "adopted");

/** Configuration, read the same way every caller reads it. */
export const readContext = (repoRoot) => {
  const runtimeParsed = parseEnvFile(runtimePath(repoRoot));
  const backendParsed = parseEnvFile(join(repoRoot, "backend", ".env"));
  return {
    repoRoot,
    runtime: runtimeParsed === null ? null : expand(runtimeParsed),
    backendEnv: backendParsed === null ? null : expand(backendParsed),
  };
};

/* The project is named by the repository root, not inherited from a working
 * directory. Passing only --env-file let docker resolve the compose file from
 * wherever the process happened to be started, so a command aimed at one root
 * could stop containers belonging to another. */
export const composeArgs = (repoRoot, args) => [
  "compose",
  "--project-directory",
  repoRoot,
  "-f",
  join(repoRoot, "docker-compose.yml"),
  "--env-file",
  runtimePath(repoRoot),
  ...args,
];

export const compose = (repoRoot, args, options = {}) =>
  run("docker", composeArgs(repoRoot, args), { timeout: 120_000, ...options });

/** How long a start may wait for a service to report itself healthy. */
export const START_WAIT_SECONDS = 90;

/* Starting a service means waiting for it to be READY, not for docker to accept
 * the request.
 *
 * `up -d` returns once the container has been created, and a caller's next act
 * is to use the service, which is still starting. It is a race, and a hosted
 * run lost it: "explorer-postgres is up" was followed one line later by P1001,
 * can't reach the database server. Locally it won nearly every time, which is
 * what kept it invisible through every green run before it.
 *
 * `--wait` blocks on the healthcheck the compose file already defines, so the
 * readiness rule lives in one place instead of being restated as a poll here.
 * The timeout is explicit: without one compose waits forever, and the process
 * timeout would kill it with no word about which service never came up.
 *
 * Named for ONE service, not for everything a start brings up. `--wait` waits
 * for every service in the command, so a caller that listed two would turn one
 * unhealthy service into a refusal to start at all. */
export const waitArgs = (service) => [
  "up",
  "-d",
  "--wait",
  "--wait-timeout",
  String(START_WAIT_SECONDS),
  service,
];

/** Which of this repository's services are running right now.
 *
 * Returns null rather than an empty list when Docker cannot be asked. The two
 * are not the same thing, and recording "nothing was running" on the strength
 * of a failed query is how a container somebody else started gets stopped. */
export const runningServices = async (repoRoot) => {
  try {
    const { stdout } = await compose(repoRoot, ["ps", "--services", "--filter", "status=running"]);
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
};

/** The address a running container publishes for one of its ports. */
export const publishedPort = async (repoRoot, service, containerPort) => {
  try {
    const { stdout } = await compose(repoRoot, ["port", service, String(containerPort)]);
    const mapped = stdout.trim();
    return mapped === "" ? null : Number(mapped.slice(mapped.lastIndexOf(":") + 1));
  } catch {
    return null;
  }
};

/**
 * Which containers a stop command must leave alone.
 *
 * A container is adopted when the run that first met it found it already
 * running. On a restart the answer carries forward rather than being taken
 * again: by then this command has started them itself, so asking "what is
 * running?" a second time would call everything adopted, and the stop that
 * followed would leave running exactly what the start had started.
 */
export const adoption = (hadPrevious, previous, running) =>
  running.filter((service) => !hadPrevious || previous.includes(service));

/** The complement: everything the record does not name was started here. */
export const servicesToStop = (adopted, services = COMPOSE_SERVICES) =>
  services.filter((service) => !adopted.includes(service));

/** The adoption record, which outlives a run.
 *
 * Its absence is meaningful, and it is written before anything is started: no
 * record means this command never reached the point of starting a container,
 * so a stop may touch none of them. */
export const readAdoption = (repoRoot, scope = "existing") => {
  const path = adoptedPath(repoRoot, scope);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split(/\s+/).filter(Boolean);
};

export const writeAdoption = (repoRoot, services, scope = "existing") => {
  const path = adoptedPath(repoRoot, scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, services.join(" "));
};

export const clearAdoption = (repoRoot, scope = "existing") => {
  rmSync(adoptedPath(repoRoot, scope), { force: true });
};

/** Records what is running before anything starts it, and returns the result.
 *
 * Nothing is written when Docker cannot be asked, because a guess recorded as
 * an answer is worse than no answer. */
export const recordAdoption = async (repoRoot, { scope = "existing", services = COMPOSE_SERVICES } = {}) => {
  const previous = readAdoption(repoRoot, scope);
  const running = await runningServices(repoRoot);
  if (running === null) return null;
  // Only the services this caller manages. A container it never starts is not
  // its to adopt, and not its to stop.
  const mine = running.filter((service) => services.includes(service));
  const adopted = adoption(previous !== null, previous ?? [], mine);
  writeAdoption(repoRoot, adopted, scope);
  return adopted;
};
