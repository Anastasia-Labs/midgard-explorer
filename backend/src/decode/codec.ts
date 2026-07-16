/**
 * Cached dynamic import of the ESM-only Midgard codec (`@al-ft/midgard-core`) so it
 * can be consumed from this CommonJS backend.
 *
 * This is the documented CJS->ESM interop pattern: a static `import` would be
 * transpiled to `require()` and fail (the codec and its `cborg` dependency are
 * ESM-only). `module: "Node18"` in tsconfig preserves the dynamic `import()` at
 * runtime, so the ESM graph loads through Node's ESM loader. The promise is cached
 * so the module (and its WASM init) is loaded once per process.
 *
 * `resolution-mode: "import"` tells TypeScript to resolve the package's ESM type
 * declarations (`index.d.ts`) rather than the CJS ones — matching the ESM build we
 * actually load at runtime. Without it, a `typeof import()` type query from this
 * CommonJS module is a TS1542 error.
 */
export type MidgardCodec = typeof import("@al-ft/midgard-core", {
  with: { "resolution-mode": "import" },
});

let codecPromise: Promise<MidgardCodec> | null = null;

export const getCodec = (): Promise<MidgardCodec> =>
  (codecPromise ??= import("@al-ft/midgard-core") as Promise<MidgardCodec>);
