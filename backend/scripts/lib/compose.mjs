/**
 * The containers the explorer owns, and the rules about touching them.
 *
 * Two of them: the PostgreSQL holding the explorer's own L1 index, and the
 * Nginx cache in front of the API. Both are declared in the repository's
 * docker-compose.yml and configured from .dev/runtime.env. Development starts
 * only the first: the cache is part of the deployed shape, and nothing about
 * the API's meaning changes when it is absent.
 *
 * This module is the only implementation of three rules:
 *
 *   ownership   which database a migration may be applied to
 *   adoption    which containers a stop command may touch
 *   lifecycle   how they are started and stopped
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { effectiveIndexUrl, expand, parseEnvFile, urlTarget } from "./env.mjs";

const run = promisify(execFile);

/** The services this repository defines. Named here rather than discovered, so
 * a service added to the Compose file for some other purpose is not swept into
 * the set a development command starts and stops. */
export const COMPOSE_SERVICES = ["explorer-postgres", "explorer-api-cache"];

/** Hosts that mean "this machine". A database reachable only from here is the
 * weakest form of evidence that it is disposable, and it is one of several
 * conditions rather than the whole test. */
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1"];

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

/**
 * Whether the index a migration would be applied to is one this repository owns.
 *
 * The URL examined is the one `prisma migrate deploy` and the backend actually
 * read. `prisma.indexer.config.ts` loads backend/.env and leaves a non-empty
 * process variable alone, so a safe-looking .dev/runtime.env in front of a
 * remote backend/.env would otherwise pass while the remote database was the
 * one migrated.
 *
 * Ownership is established rather than asserted: `docker compose port` answers
 * with the address the running container publishes, so a URL resolving anywhere
 * else is not this service, whatever it has been named.
 *
 * Returns the reasons it is not owned. Empty means it is.
 */
export const ownershipProblems = ({ index, provisioned, published }) => {
  const problems = [];
  if (index === null) return ["INDEXER_POSTGRES_URL is not a URL"];
  if (published === null) {
    problems.push(
      "explorer-postgres publishes no port, so nothing identifies it as this repository's database",
    );
  } else if (index.port !== published) {
    problems.push(`the index is on port ${index.port}; explorer-postgres publishes ${published}`);
  }
  if (!LOCAL_HOSTS.includes(index.host)) {
    problems.push(`the index is on ${index.host}, which is not this machine`);
  }
  if (index.database !== provisioned.database) {
    problems.push(
      `the index database is "${index.database}"; Compose provisions "${provisioned.database}"`,
    );
  }
  if (index.user !== provisioned.user) {
    problems.push(`the index user is "${index.user}"; Compose provisions "${provisioned.user}"`);
  }
  return problems;
};

/** The same question, asked against this machine. */
export const checkOwnership = async (repoRoot) => {
  const { runtime, backendEnv } = readContext(repoRoot);
  const { url, source } = effectiveIndexUrl({
    processEnv: process.env,
    backendEnv,
    runtime,
  });
  const target = urlTarget(url);
  const index =
    target === null
      ? null
      : { ...target, user: (() => {
          try {
            return decodeURIComponent(new URL(url).username);
          } catch {
            return "";
          }
        })() };
  const problems = ownershipProblems({
    index,
    provisioned: {
      database: runtime?.get("EXPLORER_POSTGRES_DB") ?? "",
      user: runtime?.get("EXPLORER_POSTGRES_USER") ?? "",
    },
    published: await publishedPort(repoRoot, "explorer-postgres", 5432),
  });
  return { problems, source, url };
};
