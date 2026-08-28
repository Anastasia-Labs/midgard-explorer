-- CreateTable
CREATE TABLE "l1_tx" (
    "tx_hash" TEXT NOT NULL,
    "block_height" INTEGER NOT NULL,
    "block_hash" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "tx_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "l1_tx_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateTable
CREATE TABLE "l1_event" (
    "id" SERIAL NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "validator" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "output_index" INTEGER NOT NULL,
    "lovelace" BIGINT NOT NULL,
    "datum" JSONB,

    CONSTRAINT "l1_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "l1_block_header" (
    "header_hash" TEXT NOT NULL,
    "l1_tx_hash" TEXT NOT NULL,
    "prev_utxos_root" TEXT NOT NULL,
    "utxos_root" TEXT NOT NULL,
    "withdrawals_root" TEXT NOT NULL,
    "forced_transactions_root" TEXT NOT NULL,
    "transactions_root" TEXT NOT NULL,
    "deposits_root" TEXT NOT NULL,
    "transition_trace_root" TEXT NOT NULL,
    "event_to_step_root" TEXT NOT NULL,
    "withdrawal_count" BIGINT NOT NULL,
    "forced_transaction_count" BIGINT NOT NULL,
    "l2_transaction_count" BIGINT NOT NULL,
    "deposit_count" BIGINT NOT NULL,
    "total_event_count" BIGINT NOT NULL,
    "transition_step_count" BIGINT NOT NULL,
    "start_time" BIGINT NOT NULL,
    "end_time" BIGINT NOT NULL,
    "prev_header_hash" TEXT NOT NULL,
    "operator_vkey" TEXT NOT NULL,
    "protocol_version" BIGINT NOT NULL,

    CONSTRAINT "l1_block_header_pkey" PRIMARY KEY ("header_hash")
);

-- CreateIndex
CREATE INDEX "l1_tx_block_height_idx" ON "l1_tx"("block_height");

-- CreateIndex
CREATE INDEX "l1_event_validator_idx" ON "l1_event"("validator");

-- CreateIndex
CREATE UNIQUE INDEX "l1_event_tx_output_key" ON "l1_event"("tx_hash", "output_index");

-- CreateIndex
CREATE INDEX "l1_block_header_l1_tx_hash_idx" ON "l1_block_header"("l1_tx_hash");

-- CreateIndex
CREATE INDEX "l1_block_header_prev_utxos_root_idx" ON "l1_block_header"("prev_utxos_root");

-- AddForeignKey
ALTER TABLE "l1_event" ADD CONSTRAINT "l1_event_tx_hash_fkey" FOREIGN KEY ("tx_hash") REFERENCES "l1_tx"("tx_hash") ON DELETE CASCADE ON UPDATE CASCADE;
