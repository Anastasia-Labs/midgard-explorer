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

//TODO:

// https://etherscan.io/

// Dave Dionisio
// 18:34
// https://ncl-tracker.vercel.app/alpha-growth-votes

// Anastasia Labs
// 18:35
// https://www.tryethernal.com/

// Anastasia Labs
// 18:37
// https://explorer.blockscout.com/txs
// https://explorer.blockscout.com/chain/ethereum/tx/0x80ccf522eb0892d3006aa99c069472033ae6c012132e0ef6cbba1ff830a7ed1a?tab=index

// Keyan Maskoot
// 18:42
// https://x.com/blocksmithy/status/2083139400184078485

// Dave Dionisio
// 18:44
// https://eutxo.org/

// https://global.cardano-visualisation.com/

// Anastasia Labs
// 18:44
// https://cexplorer.io/tx/8234f0fab25f0bd2543b004ef9d5c2abcf4c7ec4f81813ccee08cde9225d86ae?tab=overview

// Anastasia Labs
// 18:47
// https://cexplorer.io/tx/2477b823f521d85965a07bd51f1e6f5c9c2e3d5f510dc74a9f51d17c89808075?tab=overview\
// https://cexplorer.io/tx/2477b823f521d85965a07bd51f1e6f5c9c2e3d5f510dc74a9f51d17c89808075?tab=overview

// Anastasia Labs
// 18:49
// Rich transaction cards, React application, hundreds of visible nodes
// React Flow + ELK.js

// https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md

// [features]
// default_mode_request_user_input = true

// https://github.com/trailofbits/skills/tree/main/plugins
