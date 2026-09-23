import { register } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Makes `bench/cli.mts` runnable as a program.
 *
 * The bench modules import each other by the `.mjs` specifier TypeScript
 * expects for a `.mts` file. `tsc` and Vitest both resolve that to the `.mts`
 * on disk; Node's type stripping does not, so `node --experimental-strip-types
 * bench/cli.mts` failed on the first relative import. Typecheck and the smoke
 * test passed anyway, because neither goes through the CLI, so the entry point
 * was never actually executed until a baseline run tried to use it.
 *
 * `ts-node/esm` does the resolution, and `register()` is the supported form:
 * Node warns that `--loader` may be removed.
 *
 * Plain `.mjs` on purpose. Node loads this before TypeScript support exists,
 * so a `.mts` bootstrap could not be read by the very step that enables it.
 */
register("ts-node/esm", pathToFileURL("./"));
