import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const TEMPLATE = fileURLToPath(
  new URL("../../infra/nginx/explorer-api.conf.template", import.meta.url),
);
const COMPOSE = fileURLToPath(new URL("../../docker-compose.yml", import.meta.url));

/**
 * The image the deployed edge runs, read from the compose file.
 *
 * A second copy of the digest here would drift from the one deployments use,
 * and the benchmark would then describe a proxy nobody runs.
 */
export function edgeImage(compose = readFileSync(COMPOSE, "utf8")): string {
  const at = compose.indexOf("explorer-api-cache:");
  if (at === -1) throw new Error("docker-compose.yml defines no explorer-api-cache service");
  const match = /^\s+image:\s*(\S+)\s*$/m.exec(compose.slice(at));
  if (!match) throw new Error("the explorer-api-cache service names no image");
  return match[1];
}

export type EdgeHandle = {
  base: string;
  image: string;
  stop: () => Promise<void>;
};

/**
 * The deployed edge proxy, in front of the server under test.
 *
 * Public traffic reaches the API through this proxy, so the size a client
 * receives is decided here and not at the origin. The template is the
 * repository's own file, mounted read-only, and the cache lives in a tmpfs so
 * the container leaves no volume behind.
 *
 * Docker chooses the host port and this reads it back. Taking the origin's port
 * plus one assumed that port was free, and inside the test suite it was not.
 */
export async function startEdge(originPort: number): Promise<EdgeHandle> {
  const image = edgeImage();
  const name = `midgard-bench-edge-${randomBytes(4).toString("hex")}`;
  await run("docker", [
    "run", "--detach", "--rm", "--name", name,
    "--env", `BACKEND_ORIGIN=host.docker.internal:${originPort}`,
    "--env", "NGINX_ENVSUBST_FILTER=BACKEND_ORIGIN",
    "--add-host", "host.docker.internal:host-gateway",
    "--publish", "127.0.0.1::8080",
    "--volume", `${TEMPLATE}:/etc/nginx/templates/default.conf.template:ro`,
    "--tmpfs", "/var/cache/nginx",
    image,
  ]);
  const stop = async () => {
    await run("docker", ["rm", "--force", "--volumes", name]).catch(() => {});
  };

  const { stdout: published } = await run("docker", ["port", name, "8080/tcp"]).catch(
    async (error: unknown) => {
      await stop();
      throw error;
    },
  );
  const port = /127\.0\.0\.1:(\d+)/.exec(published)?.[1];
  if (port === undefined) {
    await stop();
    throw new Error(`the edge proxy published no loopback port: ${published.trim()}`);
  }
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return { base, image, stop };
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      const { stdout } = await run("docker", ["logs", name]).catch(() => ({ stdout: "" }));
      await stop();
      throw new Error(`the edge proxy never answered /healthz:\n${stdout}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
