-- AlterTable
ALTER TABLE "l1_block_header" ADD COLUMN     "block_height" INTEGER,
ALTER COLUMN "l1_tx_hash" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "l1_block_header_block_height_idx" ON "l1_block_header"("block_height");
