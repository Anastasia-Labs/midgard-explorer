-- CreateTable
CREATE TABLE "sync_cursor" (
    "source" TEXT NOT NULL,
    "last_block_height" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursor_pkey" PRIMARY KEY ("source")
);
