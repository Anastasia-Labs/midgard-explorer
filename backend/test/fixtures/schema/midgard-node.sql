-- The node's schema, as the explorer is typed against it.
--
-- Generated from prisma/schema.prisma, which is the read-only model of the
-- Midgard node's database. Regenerate with:
--   pnpm prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
--
-- CI provisioned a generic empty PostgreSQL and applied only the explorer's own
-- migrations, so every test that queries a node table either failed on a
-- missing relation or skipped, silently, on a `SELECT 1` guard that succeeded.
-- Deriving the fixture from the schema means it cannot drift from the model the
-- queries are built against.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "confirmed_ledger" (
    "tx_id" BYTEA NOT NULL,
    "outref" BYTEA NOT NULL,
    "output" BYTEA NOT NULL,
    "address" TEXT NOT NULL,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirmed_ledger_pkey" PRIMARY KEY ("outref")
);

-- CreateTable
CREATE TABLE "mempool_ledger" (
    "tx_id" BYTEA NOT NULL,
    "outref" BYTEA NOT NULL,
    "output" BYTEA NOT NULL,
    "address" TEXT NOT NULL,
    "source_event_id" BYTEA,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mempool_ledger_pkey" PRIMARY KEY ("outref")
);

-- CreateTable
CREATE TABLE "immutable" (
    "tx_id" BYTEA NOT NULL,
    "tx" BYTEA NOT NULL,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "immutable_pkey" PRIMARY KEY ("tx_id")
);

-- CreateTable
CREATE TABLE "mempool" (
    "tx_id" BYTEA NOT NULL,
    "tx" BYTEA NOT NULL,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mempool_pkey" PRIMARY KEY ("tx_id")
);

-- CreateTable
CREATE TABLE "processed_mempool" (
    "tx_id" BYTEA NOT NULL,
    "tx" BYTEA NOT NULL,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_mempool_pkey" PRIMARY KEY ("tx_id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "height" SERIAL NOT NULL,
    "header_hash" BYTEA NOT NULL,
    "tx_id" BYTEA NOT NULL,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("height")
);

-- CreateTable
CREATE TABLE "address_history" (
    "tx_id" BYTEA NOT NULL,
    "address" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_confirmed_ledger_address" ON "confirmed_ledger"("address");

-- CreateIndex
CREATE INDEX "idx_mempool_ledger_address" ON "mempool_ledger"("address");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_tx_id_key" ON "blocks"("tx_id");

-- CreateIndex
CREATE INDEX "idx_blocks_header_hash" ON "blocks"("header_hash");

-- CreateIndex
CREATE INDEX "idx_blocks_tx_id" ON "blocks"("tx_id");

-- CreateIndex
CREATE UNIQUE INDEX "address_history_tx_id_address_key" ON "address_history"("tx_id", "address");

