// The suite's environment, loaded before any test module is imported.
//
// `src/config.ts` is normally what loads `.env` through dotenv and
// dotenv-expand, and at this point in the Vitest lifecycle it has not been
// imported yet. Several helpers read `process.env.POSTGRES_URL` directly and
// would otherwise see nothing: the throwaway-database harness fails with "no
// PostgreSQL URL" against a perfectly configured checkout.
//
// dotenv's default `override: false` means a variable already provided by the
// shell wins, which is what lets CI point the suite somewhere else.
//
// This replaces a setup file that also guarded the explorer's own test index
// against pointing at real indexed data. The explorer owns no database now, so
// there is nothing left to guard: every database-backed test either reads the
// Midgard node's database or creates a throwaway one it drops afterwards.
import * as dotenv from "dotenv";
import { expand } from "dotenv-expand";

expand(dotenv.config());
