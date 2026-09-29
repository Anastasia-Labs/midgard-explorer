/**
 * The API response contracts are owned here, beside the routes that produce
 * them, in `backend/contracts/`. The frontend decodes with a generated copy in
 * `frontend/contracts/src/`.
 *
 *   node scripts/contracts.mjs write   refresh the frontend copy
 *   node scripts/contracts.mjs check   exit 1 when the copy is stale
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const backendDir = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(backendDir, "contracts");
const targetDir = path.resolve(backendDir, "../frontend/contracts/src");
const HEADER =
  "// Generated from backend/contracts by `pnpm contracts:write` in backend/. Edit the source, not this copy.\n";

const tsFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")) : []);

const mode = process.argv[2];
if (mode !== "write" && mode !== "check") {
  console.error("usage: node scripts/contracts.mjs write|check");
  process.exit(2);
}
const sources = tsFiles(sourceDir);
if (sources.length === 0) {
  console.error("contracts: backend/contracts is missing or contains no TypeScript sources");
  process.exit(1);
}

const expected = new Map(
  sources.map((file) => [file, HEADER + readFileSync(path.join(sourceDir, file), "utf8")]),
);
const current = new Map(
  tsFiles(targetDir).map((file) => [file, readFileSync(path.join(targetDir, file), "utf8")]),
);

if (mode === "write") {
  mkdirSync(targetDir, { recursive: true });
  for (const [file, text] of expected) writeFileSync(path.join(targetDir, file), text);
  for (const file of current.keys()) if (!expected.has(file)) rmSync(path.join(targetDir, file));
  console.log(`contracts: wrote ${expected.size} files to frontend/contracts/src`);
} else if (mode === "check") {
  const stale = [
    ...[...expected].filter(([file, text]) => current.get(file) !== text).map(([file]) => file),
    ...[...current.keys()].filter((file) => !expected.has(file)),
  ];
  if (stale.length > 0) {
    console.error(`contracts: frontend copy is stale: ${stale.join(", ")}. Run \`pnpm contracts:write\` in backend/.`);
    process.exit(1);
  }
  console.log(`contracts: frontend copy matches (${expected.size} files)`);
}
