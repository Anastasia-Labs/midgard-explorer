#!/usr/bin/env node
/**
 * Says, before the development server starts, whether the API it will call is
 * answering.
 *
 * It used to refuse to start when the API was down, so that a missing backend
 * was named in the terminal rather than discovered one error page at a time.
 * The frontend now starts without it: every page shows the API as unavailable,
 * and `ApiRecovery` re-renders the page once the backend answers. The message
 * stays, as a warning, because the cause of those alerts is still worth saying
 * where the command was typed.
 *
 * Demo mode does not use this: its API is the fixture server, which this
 * command starts itself.
 */
// CommonJS, so it arrives as a default export rather than a named one.
import nextEnv from "@next/env";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Next's own loader, at the version Next is pinned to.
 *
 * A hand-written reader of .env.local got the common case right and the rest
 * wrong: Next layers .env.local over .env.development over .env, expands
 * ${REFERENCES}, and honours an `export ` prefix. Checking a URL the app would
 * not have called produces an error message about somewhere nobody was going,
 * so the resolution has to be the same resolution rather than a close one.
 */
nextEnv.loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), ".."), true, {
  info: () => {},
  error: () => {},
});

/* Both bases, because they can differ. The browser calls NEXT_PUBLIC_API_BASE
 * and a server render calls API_BASE_SERVER, which is allowed to be an internal
 * address. Checking only the first left every server-rendered page failing
 * against a base nothing had looked at. */
const strip = (value) => value.replace(/\/+$/, "");
const publicBase = strip(process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:3101");
const serverBase = strip(process.env.API_BASE_SERVER ?? publicBase);

const answers = (base) =>
  fetch(`${base}/healthz`, { signal: AbortSignal.timeout(3000) })
    .then((res) => res.ok)
    .catch(() => false);

const bases = [
  ["the browser", publicBase],
  ...(serverBase === publicBase ? [] : [["server rendering", serverBase]]),
];

const unreachable = [];
for (const [who, base] of bases) {
  if (!(await answers(base))) unreachable.push([who, base]);
}

if (unreachable.length > 0) {
  for (const [who, base] of unreachable) {
    process.stderr.write(`The API ${who} calls, ${base}, is not answering yet.\n`);
  }
  process.stderr.write(
    "\n" +
      "  Starting anyway. Pages show the API as unavailable and fill\n" +
      "  themselves in once it answers, with no reload.\n" +
      "\n" +
      "  Start it in another terminal:  cd backend && pnpm dev\n" +
      "  Or run with fixture data:      pnpm dev:demo\n" +
      "  Or point somewhere else:       NEXT_PUBLIC_API_BASE=<url> pnpm dev\n\n",
  );
}

for (const [who, base] of bases) {
  if (unreachable.some(([, down]) => down === base)) continue;
  process.stdout.write(`API for ${who}: ${base} is answering\n`);
}
