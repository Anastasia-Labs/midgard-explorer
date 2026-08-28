/*
  Warnings:

  - Added the required column `block_index` to the `l1_tx` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cert_deposit` to the `l1_tx` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fee` to the `l1_tx` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `l1_tx` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total_output` to the `l1_tx` table without a default value. This is not possible if the table is not empty.

*/

-- Reset: the 20 existing rows have no value for the new non-null columns on
-- l1_tx. They are re-fetched from Koios on the next sync, so the reset is
-- accepted rather than backfilled. Cascades to l1_event.
DELETE FROM "l1_tx";

-- AlterTable
ALTER TABLE "l1_event" ADD COLUMN     "decoded" JSONB,
ADD COLUMN     "deployment" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "l1_tx" ADD COLUMN     "block_index" INTEGER NOT NULL,
ADD COLUMN     "cert_deposit" BIGINT NOT NULL,
ADD COLUMN     "fee" BIGINT NOT NULL,
ADD COLUMN     "invalid_after" BIGINT,
ADD COLUMN     "invalid_before" BIGINT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "size" INTEGER NOT NULL,
ADD COLUMN     "total_output" BIGINT NOT NULL;

-- CreateTable
CREATE TABLE "l1_tx_io" (
    "id" SERIAL NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "source_tx_hash" TEXT NOT NULL,
    "source_index" INTEGER NOT NULL,
    "address" TEXT,
    "payment_cred" TEXT,
    "stake_addr" TEXT,
    "lovelace" BIGINT NOT NULL,
    "datum_hash" TEXT,
    "inline_datum" JSONB,
    "ref_script_hash" TEXT,

    CONSTRAINT "l1_tx_io_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "l1_tx_asset" (
    "id" SERIAL NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "io_id" INTEGER,
    "kind" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "asset_name" TEXT NOT NULL,
    "fingerprint" TEXT,
    "quantity" BIGINT NOT NULL,

    CONSTRAINT "l1_tx_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "l1_redeemer" (
    "id" SERIAL NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "script_hash" TEXT NOT NULL,
    "address" TEXT,
    "purpose" TEXT NOT NULL,
    "mem_units" BIGINT NOT NULL,
    "step_units" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL,
    "datum_hash" TEXT,
    "datum" JSONB,
    "valid_contract" BOOLEAN NOT NULL,
    "script_size" INTEGER,

    CONSTRAINT "l1_redeemer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "l1_tx_io_address_idx" ON "l1_tx_io"("address");

-- CreateIndex
CREATE INDEX "l1_tx_io_source_tx_hash_source_index_idx" ON "l1_tx_io"("source_tx_hash", "source_index");

-- CreateIndex
CREATE UNIQUE INDEX "l1_tx_io_position_key" ON "l1_tx_io"("tx_hash", "kind", "position");

-- CreateIndex
CREATE INDEX "l1_tx_asset_policy_id_asset_name_idx" ON "l1_tx_asset"("policy_id", "asset_name");

-- CreateIndex
CREATE INDEX "l1_tx_asset_tx_hash_idx" ON "l1_tx_asset"("tx_hash");

-- CreateIndex
CREATE INDEX "l1_redeemer_tx_hash_idx" ON "l1_redeemer"("tx_hash");

-- CreateIndex
CREATE INDEX "l1_redeemer_script_hash_idx" ON "l1_redeemer"("script_hash");

-- CreateIndex
CREATE INDEX "l1_event_deployment_idx" ON "l1_event"("deployment");

-- CreateIndex
CREATE INDEX "l1_tx_tx_time_idx" ON "l1_tx"("tx_time");

-- AddForeignKey
ALTER TABLE "l1_tx_io" ADD CONSTRAINT "l1_tx_io_tx_hash_fkey" FOREIGN KEY ("tx_hash") REFERENCES "l1_tx"("tx_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "l1_tx_asset" ADD CONSTRAINT "l1_tx_asset_tx_hash_fkey" FOREIGN KEY ("tx_hash") REFERENCES "l1_tx"("tx_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "l1_tx_asset" ADD CONSTRAINT "l1_tx_asset_io_id_fkey" FOREIGN KEY ("io_id") REFERENCES "l1_tx_io"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "l1_redeemer" ADD CONSTRAINT "l1_redeemer_tx_hash_fkey" FOREIGN KEY ("tx_hash") REFERENCES "l1_tx"("tx_hash") ON DELETE CASCADE ON UPDATE CASCADE;
