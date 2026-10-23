-- CreateTable
CREATE TABLE "l1_protocol_params" (
    "epoch_no" INTEGER NOT NULL,
    "max_tx_ex_mem" BIGINT NOT NULL,
    "max_tx_ex_steps" BIGINT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "l1_protocol_params_pkey" PRIMARY KEY ("epoch_no")
);
