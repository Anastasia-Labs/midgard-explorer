import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { defineConfig } from "prisma/config";

// Second Prisma context, for the database the explorer owns. The existing
// prisma.config.ts points at the node's database, which stays read-only.
expand(dotenv.config());

/* `generate` reads no database, only the schema, and a clean clone has no .env
 * to read a URL from. Refusing to generate there makes the first command a
 * contributor runs fail on a value that command does not use, so the URL is
 * only demanded when it is going to be used. `migrate` and `db` still fail
 * loudly, at connect time, naming the placeholder. */
const GENERATE_ONLY = "postgresql://unset:unset@127.0.0.1:1/unset-run-pnpm-setup";
const url = (name: string): string => process.env[name] ?? GENERATE_ONLY;

export default defineConfig({
  schema: "prisma-indexer/schema.prisma",
  migrations: {
    path: "prisma-indexer/migrations",
  },
  datasource: {
    url: url("INDEXER_POSTGRES_URL"),
  },
});
