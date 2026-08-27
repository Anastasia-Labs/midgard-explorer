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


-- ---------------------------------------------------------------------------
-- Relations the read path queries only through raw SQL.
--
-- prisma/schema.prisma models the seven tables the explorer reads through
-- Prisma, and this fixture was generated from it, so CI provisioned a node
-- database missing every relation below. Each one is queried by a route in
-- src/db, which meant those tests failed on a missing relation or skipped on a
-- guard that succeeded, and readiness reported nothing about them at all.
--
-- Captured with pg_dump --schema-only from the preprod node on 2026-08-27,
-- with the enum types the tables depend on, which a table-restricted dump
-- leaves out.
-- Regenerate against a node database with:
--   pg_dump -h <host> -p <port> -U <user> -d <db> --schema-only --no-owner \
--     --no-privileges --no-comments -t public.<table> ...
-- ---------------------------------------------------------------------------

--
-- PostgreSQL database dump
--

\restrict gwb39fusp8R82wonETVlnijYsosocfcq8sG1ITcpIOBzvE1dBV1pKzKnaJ5rcu0

-- Dumped from database version 15.15
-- Dumped by pg_dump version 18.3 (Ubuntu 18.3-1.pgdg22.04+1)

--
-- Name: da_payloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TYPE public.tx_admission_status AS ENUM ('queued', 'validating', 'accepted', 'rejected');

CREATE TABLE public.da_payloads (
    header_hash bytea NOT NULL,
    version integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    utxos_root text NOT NULL,
    forced_transactions_root text NOT NULL,
    transactions_root text NOT NULL,
    deposits_root text NOT NULL,
    withdrawals_root text NOT NULL,
    transition_trace_root text NOT NULL,
    event_to_step_root text NOT NULL,
    withdrawal_count bigint NOT NULL,
    forced_transaction_count bigint NOT NULL,
    l2_transaction_count bigint NOT NULL,
    deposit_count bigint NOT NULL,
    total_event_count bigint NOT NULL,
    transition_step_count bigint NOT NULL,
    block_start_time timestamp with time zone NOT NULL,
    block_end_time timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT da_payloads_check CHECK ((block_end_time >= block_start_time)),
    CONSTRAINT da_payloads_count_sum_check CHECK ((total_event_count = (((withdrawal_count + forced_transaction_count) + l2_transaction_count) + deposit_count))),
    CONSTRAINT da_payloads_deposit_count_check CHECK ((deposit_count >= 0)),
    CONSTRAINT da_payloads_deposits_root_check CHECK ((deposits_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_event_to_step_root_check CHECK ((event_to_step_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_forced_transaction_count_check CHECK ((forced_transaction_count >= 0)),
    CONSTRAINT da_payloads_forced_transactions_root_check CHECK ((forced_transactions_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_header_hash_check CHECK ((octet_length(header_hash) = 28)),
    CONSTRAINT da_payloads_l2_transaction_count_check CHECK ((l2_transaction_count >= 0)),
    CONSTRAINT da_payloads_payload_cbor_check CHECK ((octet_length(payload_cbor) > 0)),
    CONSTRAINT da_payloads_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32)),
    CONSTRAINT da_payloads_total_event_count_check CHECK ((total_event_count >= 0)),
    CONSTRAINT da_payloads_trace_count_check CHECK ((transition_step_count = total_event_count)),
    CONSTRAINT da_payloads_transactions_root_check CHECK ((transactions_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_transition_step_count_check CHECK ((transition_step_count >= 0)),
    CONSTRAINT da_payloads_transition_trace_root_check CHECK ((transition_trace_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_utxos_root_check CHECK ((utxos_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_version_v2_check CHECK ((version = 2)),
    CONSTRAINT da_payloads_withdrawal_count_check CHECK ((withdrawal_count >= 0)),
    CONSTRAINT da_payloads_withdrawals_root_check CHECK ((withdrawals_root ~ '^[0-9a-f]{64}$'::text))
);

--
-- Name: deposits_utxos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deposits_utxos (
    event_id bytea NOT NULL,
    event_info bytea NOT NULL,
    inclusion_time timestamp with time zone NOT NULL,
    deposit_l1_tx_hash bytea NOT NULL,
    ledger_tx_id bytea NOT NULL,
    ledger_output bytea NOT NULL,
    ledger_address text NOT NULL,
    projected_header_hash bytea,
    status text NOT NULL,
    CONSTRAINT deposits_utxos_check CHECK (((status <> 'awaiting'::text) OR (projected_header_hash IS NULL))),
    CONSTRAINT deposits_utxos_status_check CHECK ((status = ANY (ARRAY['awaiting'::text, 'projected'::text, 'consumed'::text])))
);

--
-- Name: forced_transaction_utxos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forced_transaction_utxos (
    tx_order_id bytea NOT NULL,
    tx_order_l1_tx_hash bytea NOT NULL,
    tx_order_l1_output_index integer NOT NULL,
    asset_name bytea NOT NULL,
    raw_datum bytea NOT NULL,
    tx_id bytea NOT NULL,
    tx_compact bytea NOT NULL,
    forced_inclusion_value bytea NOT NULL,
    operator_validity text NOT NULL,
    inclusion_time timestamp with time zone NOT NULL,
    projected_header_hash bytea,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forced_transaction_utxos_asset_name_check CHECK (((octet_length(asset_name) >= 1) AND (octet_length(asset_name) <= 32))),
    CONSTRAINT forced_transaction_utxos_check CHECK (((status <> 'awaiting'::text) OR (projected_header_hash IS NULL))),
    CONSTRAINT forced_transaction_utxos_operator_validity_check CHECK ((operator_validity = ANY (ARRAY['TxIsValid'::text, 'NonExistentInputUtxo'::text, 'InvalidSignature'::text, 'FailedScript'::text, 'FeeTooLow'::text, 'UnbalancedTx'::text]))),
    CONSTRAINT forced_transaction_utxos_status_check CHECK ((status = ANY (ARRAY['awaiting'::text, 'projected'::text, 'finalized'::text]))),
    CONSTRAINT forced_transaction_utxos_tx_id_check CHECK ((octet_length(tx_id) = 32)),
    CONSTRAINT forced_transaction_utxos_tx_order_l1_output_index_check CHECK ((tx_order_l1_output_index >= 0)),
    CONSTRAINT forced_transaction_utxos_tx_order_l1_tx_hash_check CHECK ((octet_length(tx_order_l1_tx_hash) = 32))
);

--
-- Name: pending_block_finalization_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_deposits (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_deposits_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
);

--
-- Name: pending_block_finalization_forced_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_forced_transactions (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_forced_transact_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32)),
    CONSTRAINT pending_block_finalization_forced_transactions_ordinal_check CHECK ((ordinal >= 0))
);

--
-- Name: pending_block_finalization_txs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_txs (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_txs_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
);

--
-- Name: pending_block_finalization_withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_withdrawals (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_withdrawals_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
);

--
-- Name: pending_block_finalizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalizations (
    header_hash bytea NOT NULL,
    submitted_tx_hash bytea,
    block_end_time timestamp with time zone NOT NULL,
    status text NOT NULL,
    observed_confirmed_at_ms bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    state_queue_lease_token text NOT NULL,
    base_snapshot_id text NOT NULL,
    base_tail_out_ref text NOT NULL,
    base_tail_header_hash bytea NOT NULL,
    base_tail_datum_cbor text NOT NULL,
    base_utxos_root text NOT NULL,
    base_transactions_root text NOT NULL,
    base_deposits_root text NOT NULL,
    base_withdrawals_root text NOT NULL,
    block_start_time timestamp with time zone NOT NULL,
    expected_utxos_root text NOT NULL,
    expected_transactions_root text NOT NULL,
    expected_deposits_root text NOT NULL,
    expected_withdrawals_root text NOT NULL,
    base_forced_transactions_root text NOT NULL,
    expected_forced_transactions_root text NOT NULL,
    header_cbor bytea NOT NULL,
    expected_transition_trace_root text NOT NULL,
    expected_event_to_step_root text NOT NULL,
    expected_withdrawal_count bigint NOT NULL,
    expected_forced_transaction_count bigint NOT NULL,
    expected_l2_transaction_count bigint NOT NULL,
    expected_deposit_count bigint NOT NULL,
    expected_total_event_count bigint NOT NULL,
    expected_transition_step_count bigint NOT NULL,
    CONSTRAINT pending_block_finalizations_base_tail_header_hash_check CHECK ((octet_length(base_tail_header_hash) = 28)),
    CONSTRAINT pending_block_finalizations_expected_count_sum_check CHECK ((expected_total_event_count = (((expected_withdrawal_count + expected_forced_transaction_count) + expected_l2_transaction_count) + expected_deposit_count))),
    CONSTRAINT pending_block_finalizations_expected_deposit_count_check CHECK ((expected_deposit_count >= 0)),
    CONSTRAINT pending_block_finalizations_expected_event_to_step_root_check CHECK ((expected_event_to_step_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pending_block_finalizations_expected_forced_transaction_c_check CHECK ((expected_forced_transaction_count >= 0)),
    CONSTRAINT pending_block_finalizations_expected_l2_transaction_count_check CHECK ((expected_l2_transaction_count >= 0)),
    CONSTRAINT pending_block_finalizations_expected_total_event_count_check CHECK ((expected_total_event_count >= 0)),
    CONSTRAINT pending_block_finalizations_expected_trace_count_check CHECK ((expected_transition_step_count = expected_total_event_count)),
    CONSTRAINT pending_block_finalizations_expected_transition_step_coun_check CHECK ((expected_transition_step_count >= 0)),
    CONSTRAINT pending_block_finalizations_expected_transition_trace_roo_check CHECK ((expected_transition_trace_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pending_block_finalizations_expected_withdrawal_count_check CHECK ((expected_withdrawal_count >= 0)),
    CONSTRAINT pending_block_finalizations_header_cbor_check CHECK ((octet_length(header_cbor) > 0)),
    CONSTRAINT pending_block_finalizations_status_check CHECK ((status = ANY (ARRAY['pending_submission'::text, 'submitted_local_finalization_pending'::text, 'submitted_unconfirmed'::text, 'observed_waiting_stability'::text, 'finalized'::text, 'abandoned'::text])))
);

--
-- Name: tx_admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tx_admissions (
    tx_id bytea NOT NULL,
    tx_canonical_cbor bytea NOT NULL,
    tx_canonical_cbor_sha256 bytea NOT NULL,
    arrival_seq bigint NOT NULL,
    status public.tx_admission_status NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    validation_started_at timestamp with time zone,
    terminal_at timestamp with time zone,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    reject_code text,
    reject_detail text,
    submit_source text NOT NULL,
    request_count bigint DEFAULT 1 NOT NULL,
    CONSTRAINT tx_admissions_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT tx_admissions_check CHECK (((last_seen_at >= first_seen_at) AND (updated_at >= first_seen_at))),
    CONSTRAINT tx_admissions_check1 CHECK ((((status = 'validating'::public.tx_admission_status) AND (lease_owner IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (terminal_at IS NULL)) OR ((status <> 'validating'::public.tx_admission_status) AND (lease_owner IS NULL) AND (lease_expires_at IS NULL)))),
    CONSTRAINT tx_admissions_check2 CHECK ((((status = ANY (ARRAY['accepted'::public.tx_admission_status, 'rejected'::public.tx_admission_status])) AND (terminal_at IS NOT NULL)) OR ((status = ANY (ARRAY['queued'::public.tx_admission_status, 'validating'::public.tx_admission_status])) AND (terminal_at IS NULL)))),
    CONSTRAINT tx_admissions_check3 CHECK ((((status = 'rejected'::public.tx_admission_status) AND (reject_code IS NOT NULL)) OR ((status <> 'rejected'::public.tx_admission_status) AND (reject_code IS NULL) AND (reject_detail IS NULL)))),
    CONSTRAINT tx_admissions_request_count_check CHECK ((request_count >= 1)),
    CONSTRAINT tx_admissions_submit_source_check CHECK ((submit_source = ANY (ARRAY['native'::text, 'backfill'::text]))),
    CONSTRAINT tx_admissions_tx_canonical_cbor_check CHECK ((octet_length(tx_canonical_cbor) > 0)),
    CONSTRAINT tx_admissions_tx_canonical_cbor_sha256_check CHECK ((octet_length(tx_canonical_cbor_sha256) = 32)),
    CONSTRAINT tx_admissions_tx_id_check CHECK ((octet_length(tx_id) = 32))
);

--
-- Name: tx_admissions_arrival_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tx_admissions_arrival_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: tx_admissions_arrival_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tx_admissions_arrival_seq_seq OWNED BY public.tx_admissions.arrival_seq;

--
-- Name: tx_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tx_rejections (
    tx_id bytea NOT NULL,
    reject_code text NOT NULL,
    reject_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: withdrawal_utxos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withdrawal_utxos (
    event_id bytea NOT NULL,
    raw_event_info bytea NOT NULL,
    settlement_event_info bytea,
    inclusion_time timestamp with time zone NOT NULL,
    withdrawal_l1_tx_hash bytea NOT NULL,
    withdrawal_l1_output_index integer NOT NULL,
    asset_name bytea NOT NULL,
    l2_outref bytea NOT NULL,
    l2_owner bytea NOT NULL,
    l2_value bytea NOT NULL,
    l1_address bytea NOT NULL,
    l1_datum bytea NOT NULL,
    refund_address bytea NOT NULL,
    refund_datum bytea NOT NULL,
    validity text,
    validity_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    projected_header_hash bytea,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT withdrawal_utxos_asset_name_check CHECK (((octet_length(asset_name) >= 1) AND (octet_length(asset_name) <= 32))),
    CONSTRAINT withdrawal_utxos_check CHECK (((status = 'awaiting'::text) OR (settlement_event_info IS NOT NULL))),
    CONSTRAINT withdrawal_utxos_check1 CHECK (((status = 'awaiting'::text) OR (validity IS NOT NULL))),
    CONSTRAINT withdrawal_utxos_check2 CHECK (((status <> 'awaiting'::text) OR (projected_header_hash IS NULL))),
    CONSTRAINT withdrawal_utxos_l2_owner_check CHECK ((octet_length(l2_owner) = 28)),
    CONSTRAINT withdrawal_utxos_status_check CHECK ((status = ANY (ARRAY['awaiting'::text, 'projected'::text, 'finalized'::text]))),
    CONSTRAINT withdrawal_utxos_validity_check CHECK (((validity IS NULL) OR (validity = ANY (ARRAY['WithdrawalIsValid'::text, 'NonExistentWithdrawalUtxo'::text, 'SpentWithdrawalUtxo'::text, 'IncorrectWithdrawalOwner'::text, 'IncorrectWithdrawalValue'::text, 'IncorrectWithdrawalSignature'::text, 'TooManyTokensInWithdrawal'::text, 'UnpayableWithdrawalValue'::text])))),
    CONSTRAINT withdrawal_utxos_withdrawal_l1_output_index_check CHECK ((withdrawal_l1_output_index >= 0)),
    CONSTRAINT withdrawal_utxos_withdrawal_l1_tx_hash_check CHECK ((octet_length(withdrawal_l1_tx_hash) = 32))
);

--
-- Name: tx_admissions arrival_seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_admissions ALTER COLUMN arrival_seq SET DEFAULT nextval('public.tx_admissions_arrival_seq_seq'::regclass);

--
-- Name: da_payloads da_payloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.da_payloads
    ADD CONSTRAINT da_payloads_pkey PRIMARY KEY (header_hash);

--
-- Name: deposits_utxos deposits_utxos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deposits_utxos
    ADD CONSTRAINT deposits_utxos_pkey PRIMARY KEY (event_id);

--
-- Name: forced_transaction_utxos forced_transaction_utxos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forced_transaction_utxos
    ADD CONSTRAINT forced_transaction_utxos_pkey PRIMARY KEY (tx_order_id);

--
-- Name: forced_transaction_utxos forced_transaction_utxos_tx_order_l1_tx_hash_tx_order_l1_ou_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forced_transaction_utxos
    ADD CONSTRAINT forced_transaction_utxos_tx_order_l1_tx_hash_tx_order_l1_ou_key UNIQUE (tx_order_l1_tx_hash, tx_order_l1_output_index);

--
-- Name: pending_block_finalization_deposits pending_block_finalization_deposits_header_hash_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_deposits
    ADD CONSTRAINT pending_block_finalization_deposits_header_hash_ordinal_key UNIQUE (header_hash, ordinal);

--
-- Name: pending_block_finalization_deposits pending_block_finalization_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_deposits
    ADD CONSTRAINT pending_block_finalization_deposits_pkey PRIMARY KEY (header_hash, member_id);

--
-- Name: pending_block_finalization_forced_transactions pending_block_finalization_forced_trans_header_hash_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_forced_transactions
    ADD CONSTRAINT pending_block_finalization_forced_trans_header_hash_ordinal_key UNIQUE (header_hash, ordinal);

--
-- Name: pending_block_finalization_forced_transactions pending_block_finalization_forced_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_forced_transactions
    ADD CONSTRAINT pending_block_finalization_forced_transactions_pkey PRIMARY KEY (header_hash, member_id);

--
-- Name: pending_block_finalization_txs pending_block_finalization_txs_header_hash_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_txs
    ADD CONSTRAINT pending_block_finalization_txs_header_hash_ordinal_key UNIQUE (header_hash, ordinal);

--
-- Name: pending_block_finalization_txs pending_block_finalization_txs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_txs
    ADD CONSTRAINT pending_block_finalization_txs_pkey PRIMARY KEY (header_hash, member_id);

--
-- Name: pending_block_finalization_withdrawals pending_block_finalization_withdrawals_header_hash_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_withdrawals
    ADD CONSTRAINT pending_block_finalization_withdrawals_header_hash_ordinal_key UNIQUE (header_hash, ordinal);

--
-- Name: pending_block_finalization_withdrawals pending_block_finalization_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_withdrawals
    ADD CONSTRAINT pending_block_finalization_withdrawals_pkey PRIMARY KEY (header_hash, member_id);

--
-- Name: pending_block_finalizations pending_block_finalizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalizations
    ADD CONSTRAINT pending_block_finalizations_pkey PRIMARY KEY (header_hash);

--
-- Name: pending_block_finalizations pending_block_finalizations_submitted_tx_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalizations
    ADD CONSTRAINT pending_block_finalizations_submitted_tx_hash_key UNIQUE (submitted_tx_hash);

--
-- Name: tx_admissions tx_admissions_arrival_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_admissions
    ADD CONSTRAINT tx_admissions_arrival_seq_key UNIQUE (arrival_seq);

--
-- Name: tx_admissions tx_admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_admissions
    ADD CONSTRAINT tx_admissions_pkey PRIMARY KEY (tx_id);

--
-- Name: withdrawal_utxos withdrawal_utxos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawal_utxos
    ADD CONSTRAINT withdrawal_utxos_pkey PRIMARY KEY (event_id);

--
-- Name: withdrawal_utxos withdrawal_utxos_withdrawal_l1_tx_hash_withdrawal_l1_output_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdrawal_utxos
    ADD CONSTRAINT withdrawal_utxos_withdrawal_l1_tx_hash_withdrawal_l1_output_key UNIQUE (withdrawal_l1_tx_hash, withdrawal_l1_output_index);

--
-- Name: idx_da_payloads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_payloads_created_at ON public.da_payloads USING btree (created_at);

--
-- Name: idx_deposits_utxos_deposit_l1_tx_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deposits_utxos_deposit_l1_tx_hash ON public.deposits_utxos USING btree (deposit_l1_tx_hash);

--
-- Name: idx_deposits_utxos_projected_header_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deposits_utxos_projected_header_hash ON public.deposits_utxos USING btree (projected_header_hash);

--
-- Name: idx_deposits_utxos_status_inclusion_time_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deposits_utxos_status_inclusion_time_event_id ON public.deposits_utxos USING btree (status, inclusion_time, event_id);

--
-- Name: idx_forced_transaction_utxos_projected_header_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forced_transaction_utxos_projected_header_hash ON public.forced_transaction_utxos USING btree (projected_header_hash);

--
-- Name: idx_forced_transaction_utxos_status_inclusion_time_tx_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forced_transaction_utxos_status_inclusion_time_tx_order_id ON public.forced_transaction_utxos USING btree (status, inclusion_time, tx_order_id);

--
-- Name: idx_forced_transaction_utxos_tx_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forced_transaction_utxos_tx_id ON public.forced_transaction_utxos USING btree (tx_id);

--
-- Name: idx_pending_block_finalizations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_block_finalizations_status ON public.pending_block_finalizations USING btree (status);

--
-- Name: idx_tx_admissions_dequeue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_admissions_dequeue ON public.tx_admissions USING btree (next_attempt_at, arrival_seq) WHERE (status = ANY (ARRAY['queued'::public.tx_admission_status, 'validating'::public.tx_admission_status]));

--
-- Name: idx_tx_admissions_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_admissions_lease ON public.tx_admissions USING btree (lease_expires_at) WHERE (status = 'validating'::public.tx_admission_status);

--
-- Name: idx_tx_admissions_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_admissions_status_updated ON public.tx_admissions USING btree (status, updated_at);

--
-- Name: idx_tx_rejections_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_rejections_created_at ON public.tx_rejections USING btree (created_at);

--
-- Name: idx_tx_rejections_tx_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_rejections_tx_id ON public.tx_rejections USING btree (tx_id);

--
-- Name: idx_withdrawal_utxos_l2_outref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_utxos_l2_outref ON public.withdrawal_utxos USING btree (l2_outref);

--
-- Name: idx_withdrawal_utxos_projected_header_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_utxos_projected_header_hash ON public.withdrawal_utxos USING btree (projected_header_hash);

--
-- Name: idx_withdrawal_utxos_status_inclusion_time_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_utxos_status_inclusion_time_event_id ON public.withdrawal_utxos USING btree (status, inclusion_time, event_id);

--
-- Name: idx_withdrawal_utxos_withdrawal_l1_tx_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_utxos_withdrawal_l1_tx_hash ON public.withdrawal_utxos USING btree (withdrawal_l1_tx_hash);

--
-- Name: uniq_pending_block_finalizations_single_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_pending_block_finalizations_single_active ON public.pending_block_finalizations USING btree ((1)) WHERE (status = ANY (ARRAY['pending_submission'::text, 'submitted_local_finalization_pending'::text, 'submitted_unconfirmed'::text, 'observed_waiting_stability'::text]));

--
-- Name: uniq_tx_rejections_tx_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_tx_rejections_tx_id ON public.tx_rejections USING btree (tx_id);

--
-- Name: pending_block_finalization_deposits pending_block_finalization_deposits_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_deposits
    ADD CONSTRAINT pending_block_finalization_deposits_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

--
-- Name: pending_block_finalization_deposits pending_block_finalization_deposits_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_deposits
    ADD CONSTRAINT pending_block_finalization_deposits_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.deposits_utxos(event_id) ON DELETE RESTRICT;

--
-- Name: pending_block_finalization_forced_transactions pending_block_finalization_forced_transactions_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_forced_transactions
    ADD CONSTRAINT pending_block_finalization_forced_transactions_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

--
-- Name: pending_block_finalization_txs pending_block_finalization_txs_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_txs
    ADD CONSTRAINT pending_block_finalization_txs_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

--
-- Name: pending_block_finalization_withdrawals pending_block_finalization_withdrawals_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_withdrawals
    ADD CONSTRAINT pending_block_finalization_withdrawals_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

--
-- Name: pending_block_finalization_withdrawals pending_block_finalization_withdrawals_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_withdrawals
    ADD CONSTRAINT pending_block_finalization_withdrawals_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.withdrawal_utxos(event_id) ON DELETE RESTRICT;

--
-- PostgreSQL database dump complete
--

\unrestrict gwb39fusp8R82wonETVlnijYsosocfcq8sG1ITcpIOBzvE1dBV1pKzKnaJ5rcu0
