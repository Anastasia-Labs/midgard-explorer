import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { defineConfig, env } from "prisma/config";

// Runs in the Prisma CLI's own process, so it loads + expands .env itself
// (POSTGRES_URL references the discrete POSTGRES_* vars).
expand(dotenv.config());

// Prisma 7 moved the connection URL out of schema.prisma. The CLI (generate,
// validate, migrate) reads it from here; the runtime client connects via the
// PrismaPg driver adapter (see src/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("POSTGRES_URL"),
  },
});
