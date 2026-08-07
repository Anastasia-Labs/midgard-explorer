import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { defineConfig, env } from "prisma/config";

// Second Prisma context, for the database the explorer owns. The existing
// prisma.config.ts points at the node's database, which stays read-only.
expand(dotenv.config());

export default defineConfig({
  schema: "prisma-indexer/schema.prisma",
  migrations: {
    path: "prisma-indexer/migrations",
  },
  datasource: {
    url: env("INDEXER_POSTGRES_URL"),
  },
});
