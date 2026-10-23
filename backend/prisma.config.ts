import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { defineConfig } from "prisma/config";

// Runs in the Prisma CLI's own process, so it loads + expands .env itself
// (POSTGRES_URL references the discrete POSTGRES_* vars).
expand(dotenv.config());

/* `generate` reads no database, only the schema, and a clean clone has no .env
 * to read a URL from. Refusing to generate there makes the first command a
 * contributor runs fail on a value that command does not use, so the URL is
 * only demanded when it is going to be used. `migrate` and `db` still fail
 * loudly, at connect time, naming the placeholder. */
const GENERATE_ONLY = "postgresql://unset:unset@127.0.0.1:1/unset-run-pnpm-setup";
const url = (name: string): string => process.env[name] ?? GENERATE_ONLY;

// Prisma 7 moved the connection URL out of schema.prisma. The CLI (generate,
// validate, migrate) reads it from here; the runtime client connects via the
// PrismaPg driver adapter (see src/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: url("POSTGRES_URL"),
  },
});
