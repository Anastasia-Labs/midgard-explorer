import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/explorer-client";
import { config } from "./config";

// Prisma 7 connects through a driver adapter rather than a schema datasource URL.
// config loads + expands .env, so POSTGRES_URL is fully resolved here.
const adapter = new PrismaPg({ connectionString: config.POSTGRES_URL });
export const prisma = new PrismaClient({ adapter });
