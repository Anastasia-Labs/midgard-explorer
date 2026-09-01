/**
 * Configuration reading, for the commands under scripts/dev.
 *
 * The implementation lives in backend/scripts/lib/env.mjs, because the backend
 * is what these settings configure and what enforces them: it declares which
 * are required, it resolves the index URL that its own migrations apply to, and
 * it is the package a contributor runs. This file exists so `./dev` reaches the
 * same code rather than a second copy of it.
 */
export {
  GENERATED_FILES,
  INDEX_TARGET_KEYS,
  PLACEHOLDERS,
  RUNTIME_LINKS,
  RUNTIME_SHELL_KEYS,
  backendSettings,
  effectiveIndexUrl,
  expand,
  isPlaceholder,
  parseEnvFile,
  redact,
  redactValue,
  runtimeShellValues,
  urlTarget,
} from "../../backend/scripts/lib/env.mjs";
