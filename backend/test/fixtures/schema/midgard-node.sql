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
    "included_by" BYTEA,

    CONSTRAINT "mempool_pkey" PRIMARY KEY ("tx_id")
);

-- CreateTable
CREATE TABLE "processed_mempool" (
    "tx_id" BYTEA NOT NULL,
    "tx" BYTEA NOT NULL,
    "time_stamp_tz" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "included_by" BYTEA,

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
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
-- Captured 2026-10-19 with pg_dump --schema-only from an empty PostgreSQL with
-- Midgard f4cf28ca100e99f5bc07c7b1ed6e9b936062a44d migrations 0001 to 0027
-- applied (demo/midgard-node/src/database/migrations/sql), with the enum type
-- the tables depend on, which a table-restricted dump leaves out. The dump's
-- two triggers on deposits_utxos and withdrawal_utxos are left out: they queue
-- settlement jobs in operator tables this fixture does not carry. Outside the
-- L1 follower's own tables and migration bookkeeping, that schema equals the
-- live Preprod node's statement for statement on the same day.
-- Regenerate against a database with those migrations applied:
--   pg_dump -h <host> -p <port> -U <user> -d <db> --schema-only --no-owner \
--     --no-privileges --no-comments -t public.<table> ...
-- ---------------------------------------------------------------------------

CREATE TYPE public.tx_admission_status AS ENUM ('queued', 'validating', 'accepted', 'rejected');

--
-- PostgreSQL database dump
--

\restrict EeYVZGEQXSEdLj0Eg14ExARYEvQoRKK8VA2eSmDosJENQkYqePcs5Nza3dSXbDf

-- Dumped from database version 17.11
-- Dumped by pg_dump version 18.3 (Ubuntu 18.3-1.pgdg22.04+1)

--
-- Name: da_payloads; Type: TABLE; Schema: public; Owner: -
--

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
    consensus_profile_id text NOT NULL,
    validation_traces_root text DEFAULT '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'::text NOT NULL,
    validation_trace_count bigint DEFAULT 0 NOT NULL,
    block_start_time timestamp with time zone NOT NULL,
    block_end_time timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    block_time timestamp with time zone NOT NULL,
    CONSTRAINT da_payloads_block_time_covers_end CHECK ((block_end_time <= block_time)),
    CONSTRAINT da_payloads_check CHECK ((block_end_time >= block_start_time)),
    CONSTRAINT da_payloads_consensus_profile_id_check CHECK ((consensus_profile_id = 'midgard-consensus-v1'::text)),
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
    CONSTRAINT da_payloads_profile_version_check CHECK (((version = 1) AND (validation_trace_count = (forced_transaction_count + l2_transaction_count)) AND (((validation_trace_count = 0) AND (validation_traces_root = '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'::text)) OR ((validation_trace_count > 0) AND (validation_traces_root <> '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'::text))))),
    CONSTRAINT da_payloads_total_event_count_check CHECK ((total_event_count >= 0)),
    CONSTRAINT da_payloads_trace_count_check CHECK ((transition_step_count = total_event_count)),
    CONSTRAINT da_payloads_transactions_root_check CHECK ((transactions_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_transition_step_count_check CHECK ((transition_step_count >= 0)),
    CONSTRAINT da_payloads_transition_trace_root_check CHECK ((transition_trace_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_utxos_root_check CHECK ((utxos_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT da_payloads_validation_trace_count_check CHECK ((validation_trace_count >= 0)),
    CONSTRAINT da_payloads_validation_traces_root_check CHECK ((validation_traces_root ~ '^[0-9a-f]{64}$'::text)),
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
    l1_event_key bytea,
    l1_origin_outref bytea,
    CONSTRAINT deposits_utxos_check CHECK (((status <> 'awaiting'::text) OR (projected_header_hash IS NULL))),
    CONSTRAINT deposits_utxos_l1_admission_check CHECK ((((l1_event_key IS NULL) AND (l1_origin_outref IS NULL)) OR ((l1_event_key IS NOT NULL) AND (l1_origin_outref IS NOT NULL) AND (octet_length(l1_event_key) = 32) AND (octet_length(l1_origin_outref) = 34) AND (SUBSTRING(l1_origin_outref FROM 1 FOR 32) = deposit_l1_tx_hash)))),
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
    consensus_profile_id text NOT NULL,
    native_tx_cbor bytea NOT NULL,
    transaction_commitment bytea NOT NULL,
    cek_program_material_sidecar_cbor bytea NOT NULL,
    cek_program_material_sidecar_sha256 bytea NOT NULL,
    inclusion_time timestamp with time zone NOT NULL,
    projected_header_hash bytea,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT forced_transaction_utxos_asset_name_check CHECK (((octet_length(asset_name) >= 1) AND (octet_length(asset_name) <= 32))),
    CONSTRAINT forced_transaction_utxos_check CHECK (((status <> 'awaiting'::text) OR (projected_header_hash IS NULL))),
    CONSTRAINT forced_transaction_utxos_exact_proof_material CHECK (((consensus_profile_id = 'midgard-consensus-v1'::text) AND (octet_length(native_tx_cbor) <= 295041) AND (octet_length(transaction_commitment) = 32) AND (octet_length(cek_program_material_sidecar_cbor) > 0) AND (octet_length(cek_program_material_sidecar_sha256) = 32))),
    CONSTRAINT forced_transaction_utxos_status_check CHECK ((status = ANY (ARRAY['awaiting'::text, 'projected'::text, 'finalized'::text]))),
    CONSTRAINT forced_transaction_utxos_tx_id_check CHECK ((octet_length(tx_id) = 32)),
    CONSTRAINT forced_transaction_utxos_tx_order_l1_output_index_check CHECK ((tx_order_l1_output_index >= 0)),
    CONSTRAINT forced_transaction_utxos_tx_order_l1_tx_hash_check CHECK ((octet_length(tx_order_l1_tx_hash) = 32))
);

--
-- Name: mempool_tx_deltas; Type: TABLE; Schema: public; Owner: -
--

CREATE UNLOGGED TABLE public.mempool_tx_deltas (
    tx_id bytea NOT NULL,
    spent_cbor bytea NOT NULL,
    produced_cbor bytea NOT NULL
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
    l1_event_key bytea,
    l1_origin_outref bytea,
    CONSTRAINT pending_block_finalization_deposits_l1_admission_check CHECK ((((l1_event_key IS NULL) AND (l1_origin_outref IS NULL)) OR ((l1_event_key IS NOT NULL) AND (l1_origin_outref IS NOT NULL) AND (octet_length(l1_event_key) = 32) AND (octet_length(l1_origin_outref) = 34)))),
    CONSTRAINT pending_block_finalization_deposits_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
);

--
-- Name: pending_block_finalization_event_to_step; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_event_to_step (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_event_to_step_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT pending_block_finalization_event_to_step_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
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
-- Name: pending_block_finalization_transition_trace; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_transition_trace (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_transition_trac_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32)),
    CONSTRAINT pending_block_finalization_transition_trace_ordinal_check CHECK ((ordinal >= 0))
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
    cek_program_material_sidecar_cbor bytea NOT NULL,
    cek_program_material_sidecar_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalization_txs_cek_program_material_check CHECK (((octet_length(cek_program_material_sidecar_cbor) > 0) AND (octet_length(cek_program_material_sidecar_sha256) = 32))),
    CONSTRAINT pending_block_finalization_txs_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
);

--
-- Name: pending_block_finalization_withdrawals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalization_withdrawals (
    header_hash bytea NOT NULL,
    member_id bytea NOT NULL,
    ordinal integer NOT NULL,
    validity text NOT NULL,
    validity_detail jsonb NOT NULL,
    classification_revision integer NOT NULL,
    classification_sha256 bytea NOT NULL,
    payload_cbor bytea NOT NULL,
    payload_sha256 bytea NOT NULL,
    source_table text NOT NULL,
    source_id bytea NOT NULL,
    source_time_stamp_tz timestamp with time zone NOT NULL,
    l1_event_key bytea,
    l1_origin_outref bytea,
    CONSTRAINT pending_block_finalization_withdr_classification_revision_check CHECK ((classification_revision >= 0)),
    CONSTRAINT pending_block_finalization_withdraw_classification_sha256_check CHECK ((octet_length(classification_sha256) = 32)),
    CONSTRAINT pending_block_finalization_withdrawals_l1_admission_check CHECK ((((l1_event_key IS NULL) AND (l1_origin_outref IS NULL)) OR ((l1_event_key IS NOT NULL) AND (l1_origin_outref IS NOT NULL) AND (octet_length(l1_event_key) = 32) AND (octet_length(l1_origin_outref) = 34)))),
    CONSTRAINT pending_block_finalization_withdrawals_payload_sha256_check CHECK ((octet_length(payload_sha256) = 32))
);

--
-- Name: pending_block_finalizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_block_finalizations (
    correction_transition_digest text,
    header_hash bytea NOT NULL,
    submitted_tx_hash bytea,
    prepared_tx_hash bytea,
    intended_tx_hash bytea,
    signed_tx_cbor bytea,
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
    format_version smallint NOT NULL,
    replay_kind text NOT NULL,
    deployment_marker_schema_version text NOT NULL,
    deployment_manifest_id text NOT NULL,
    expected_transition_trace_root text NOT NULL,
    expected_event_to_step_root text NOT NULL,
    expected_withdrawal_count bigint NOT NULL,
    expected_forced_transaction_count bigint NOT NULL,
    expected_l2_transaction_count bigint NOT NULL,
    expected_deposit_count bigint NOT NULL,
    expected_total_event_count bigint NOT NULL,
    expected_transition_step_count bigint NOT NULL,
    consensus_profile_id text NOT NULL,
    expected_validation_traces_root text NOT NULL,
    expected_validation_trace_count bigint NOT NULL,
    ledger_delta_spent jsonb NOT NULL,
    ledger_delta_produced jsonb NOT NULL,
    mpf_owner_schema smallint,
    mpf_owner_binary_sha256 bytea,
    mpf_replay_base_root bytea,
    mpf_replay_candidate_root bytea,
    mpf_replay_event_log bytea,
    mpf_replay_event_log_digest bytea,
    mpf_replay_event_roots bytea,
    mpf_replay_event_count integer,
    commit_anchor_hash bytea,
    commit_anchor_height bigint,
    commit_anchor_slot bigint,
    block_time timestamp with time zone NOT NULL,
    CONSTRAINT pending_block_finalizations_base_tail_header_hash_check CHECK ((octet_length(base_tail_header_hash) = 28)),
    CONSTRAINT pending_block_finalizations_block_time_covers_end CHECK ((block_end_time <= block_time)),
    CONSTRAINT pending_block_finalizations_commit_anchor_hash_length CHECK (((commit_anchor_hash IS NULL) OR (octet_length(commit_anchor_hash) = 32))),
    CONSTRAINT pending_block_finalizations_commit_anchor_whole CHECK ((((commit_anchor_hash IS NULL) = (commit_anchor_height IS NULL)) AND ((commit_anchor_height IS NULL) = (commit_anchor_slot IS NULL)))),
    CONSTRAINT pending_block_finalizations_consensus_profile_id_check CHECK ((consensus_profile_id = 'midgard-consensus-v1'::text)),
    CONSTRAINT pending_block_finalizations_correction_transition_digest_check CHECK ((correction_transition_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pending_block_finalizations_deployment_manifest_id_check CHECK ((deployment_manifest_id ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pending_block_finalizations_deployment_marker_schema_check CHECK ((deployment_marker_schema_version = 'midgard-deployment-marker-v1'::text)),
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
    CONSTRAINT pending_block_finalizations_format_version_check CHECK ((format_version = 1)),
    CONSTRAINT pending_block_finalizations_header_cbor_check CHECK ((octet_length(header_cbor) > 0)),
    CONSTRAINT pending_block_finalizations_mpf_replay_all_or_none_check CHECK ((((replay_kind = 'ledger_delta_v1'::text) AND (mpf_owner_schema IS NULL) AND (mpf_owner_binary_sha256 IS NULL) AND (mpf_replay_base_root IS NULL) AND (mpf_replay_candidate_root IS NULL) AND (mpf_replay_event_log IS NULL) AND (mpf_replay_event_log_digest IS NULL) AND (mpf_replay_event_roots IS NULL) AND (mpf_replay_event_count IS NULL)) OR ((replay_kind = 'ledger_delta_native_mpf_v1'::text) AND (mpf_owner_schema = 1) AND (octet_length(mpf_owner_binary_sha256) = 32) AND (octet_length(mpf_replay_base_root) = 32) AND (encode(mpf_replay_base_root, 'hex'::text) = base_utxos_root) AND (octet_length(mpf_replay_candidate_root) = 32) AND (encode(mpf_replay_candidate_root, 'hex'::text) = expected_utxos_root) AND (octet_length(mpf_replay_event_log) >= 92) AND (octet_length(mpf_replay_event_log_digest) = 32) AND (mpf_replay_event_count >= 0) AND (octet_length(mpf_replay_event_roots) = (mpf_replay_event_count * 32))))),
    CONSTRAINT pending_block_finalizations_prepared_tx_hash_check CHECK (((prepared_tx_hash IS NULL) OR (octet_length(prepared_tx_hash) = 32))),
    CONSTRAINT pending_block_finalizations_profile_validation_check CHECK (((expected_validation_trace_count = (expected_forced_transaction_count + expected_l2_transaction_count)) AND (((expected_validation_trace_count = 0) AND (expected_validation_traces_root = '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'::text)) OR ((expected_validation_trace_count > 0) AND (expected_validation_traces_root <> '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'::text))))),
    CONSTRAINT pending_block_finalizations_replay_kind_check CHECK ((replay_kind = ANY (ARRAY['ledger_delta_v1'::text, 'ledger_delta_native_mpf_v1'::text]))),
    CONSTRAINT pending_block_finalizations_status_check CHECK ((status = ANY (ARRAY['pending_submission'::text, 'submitted_local_finalization_pending'::text, 'submitted_unconfirmed'::text, 'observed_waiting_stability'::text, 'locally_applied'::text, 'abandoned'::text]))),
    CONSTRAINT pending_block_finalizations_validation_count_check CHECK ((expected_validation_trace_count >= 0)),
    CONSTRAINT pending_block_finalizations_validation_root_check CHECK ((expected_validation_traces_root ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pending_signed_ack_matches_intent CHECK (((intended_tx_hash IS NULL) OR (submitted_tx_hash IS NULL) OR (intended_tx_hash = submitted_tx_hash))),
    CONSTRAINT pending_signed_intent_matches_prepared CHECK (((intended_tx_hash IS NULL) OR ((prepared_tx_hash IS NOT NULL) AND (intended_tx_hash = prepared_tx_hash)))),
    CONSTRAINT pending_signed_intent_pair CHECK ((((intended_tx_hash IS NULL) AND (signed_tx_cbor IS NULL)) OR ((intended_tx_hash IS NOT NULL) AND (octet_length(intended_tx_hash) = 32) AND (signed_tx_cbor IS NOT NULL) AND (octet_length(signed_tx_cbor) > 0))))
);

--
-- Name: tx_admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tx_admissions (
    tx_id bytea NOT NULL,
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
    CONSTRAINT tx_admissions_tx_id_check CHECK ((octet_length(tx_id) = 32))
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50000', autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50000', autovacuum_vacuum_cost_delay='0');

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
    classification_revision integer DEFAULT 0 NOT NULL,
    reopened_from_header_hash bytea,
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
    l1_event_key bytea,
    l1_origin_outref bytea,
    l2_ledger_outref bytea,
    l2_ledger_outref_state text DEFAULT 'unknown'::text NOT NULL,
    CONSTRAINT withdrawal_ledger_outref_state CHECK ((((l2_ledger_outref_state = 'decoded'::text) AND (l2_ledger_outref IS NOT NULL)) OR ((l2_ledger_outref_state = ANY (ARRAY['unknown'::text, 'undecodable'::text])) AND (l2_ledger_outref IS NULL)))),
    CONSTRAINT withdrawal_utxos_asset_name_check CHECK (((octet_length(asset_name) >= 1) AND (octet_length(asset_name) <= 32))),
    CONSTRAINT withdrawal_utxos_check CHECK (((status = 'awaiting'::text) OR (settlement_event_info IS NOT NULL))),
    CONSTRAINT withdrawal_utxos_check1 CHECK (((status = 'awaiting'::text) OR (validity IS NOT NULL))),
    CONSTRAINT withdrawal_utxos_check2 CHECK (((status <> 'awaiting'::text) OR (projected_header_hash IS NULL))),
    CONSTRAINT withdrawal_utxos_classification_revision_check CHECK ((classification_revision >= 0)),
    CONSTRAINT withdrawal_utxos_l1_admission_check CHECK ((((l1_event_key IS NULL) AND (l1_origin_outref IS NULL)) OR ((l1_event_key IS NOT NULL) AND (l1_origin_outref IS NOT NULL) AND (octet_length(l1_event_key) = 32) AND (octet_length(l1_origin_outref) = 34)))),
    CONSTRAINT withdrawal_utxos_l2_owner_check CHECK ((octet_length(l2_owner) = 28)),
    CONSTRAINT withdrawal_utxos_reopened_from_header_hash_check CHECK ((octet_length(reopened_from_header_hash) = 28)),
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
-- Name: mempool_tx_deltas mempool_tx_deltas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mempool_tx_deltas
    ADD CONSTRAINT mempool_tx_deltas_pkey PRIMARY KEY (tx_id);

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
-- Name: pending_block_finalization_event_to_step pending_block_finalization_event_to_ste_header_hash_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_event_to_step
    ADD CONSTRAINT pending_block_finalization_event_to_ste_header_hash_ordinal_key UNIQUE (header_hash, ordinal);

--
-- Name: pending_block_finalization_event_to_step pending_block_finalization_event_to_step_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_event_to_step
    ADD CONSTRAINT pending_block_finalization_event_to_step_pkey PRIMARY KEY (header_hash, member_id);

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
-- Name: pending_block_finalization_transition_trace pending_block_finalization_transition_t_header_hash_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_transition_trace
    ADD CONSTRAINT pending_block_finalization_transition_t_header_hash_ordinal_key UNIQUE (header_hash, ordinal);

--
-- Name: pending_block_finalization_transition_trace pending_block_finalization_transition_trace_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_transition_trace
    ADD CONSTRAINT pending_block_finalization_transition_trace_pkey PRIMARY KEY (header_hash, member_id);

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
-- Name: idx_deposits_utxos_l1_admission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deposits_utxos_l1_admission ON public.deposits_utxos USING btree (l1_event_key);

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
-- Name: idx_tx_admissions_active_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_admissions_active_lease ON public.tx_admissions USING btree (lease_owner, tx_id) WHERE (status = 'validating'::public.tx_admission_status);

--
-- Name: idx_tx_admissions_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_admissions_lease ON public.tx_admissions USING btree (lease_expires_at) WHERE (status = 'validating'::public.tx_admission_status);

--
-- Name: idx_tx_admissions_queued_arrival; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_admissions_queued_arrival ON public.tx_admissions USING btree (arrival_seq, tx_id) WHERE (status = 'queued'::public.tx_admission_status);

--
-- Name: idx_tx_rejections_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_rejections_created_at ON public.tx_rejections USING btree (created_at);

--
-- Name: idx_tx_rejections_tx_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_rejections_tx_id ON public.tx_rejections USING btree (tx_id);

--
-- Name: idx_withdrawal_ledger_outref_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_ledger_outref_pending ON public.withdrawal_utxos USING btree (l2_ledger_outref) WHERE ((l2_ledger_outref_state = 'decoded'::text) AND (status = ANY (ARRAY['awaiting'::text, 'projected'::text])) AND ((validity IS NULL) OR (validity = 'WithdrawalIsValid'::text)));

--
-- Name: idx_withdrawal_ledger_outref_unknown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_ledger_outref_unknown ON public.withdrawal_utxos USING btree (event_id) WHERE (l2_ledger_outref_state = 'unknown'::text);

--
-- Name: idx_withdrawal_ledger_outref_unknown_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_ledger_outref_unknown_pending ON public.withdrawal_utxos USING btree (event_id) WHERE ((l2_ledger_outref_state = 'unknown'::text) AND (status = ANY (ARRAY['awaiting'::text, 'projected'::text])) AND ((validity IS NULL) OR (validity = 'WithdrawalIsValid'::text)));

--
-- Name: idx_withdrawal_utxos_l1_admission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_utxos_l1_admission ON public.withdrawal_utxos USING btree (l1_event_key);

--
-- Name: idx_withdrawal_utxos_l1_admission_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_withdrawal_utxos_l1_admission_tx ON public.withdrawal_utxos USING btree (SUBSTRING(l1_origin_outref FROM 1 FOR 32));

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
-- Name: pending_block_finalization_event_to_step pending_block_finalization_event_to_step_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_event_to_step
    ADD CONSTRAINT pending_block_finalization_event_to_step_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

--
-- Name: pending_block_finalization_forced_transactions pending_block_finalization_forced_transactions_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_forced_transactions
    ADD CONSTRAINT pending_block_finalization_forced_transactions_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

--
-- Name: pending_block_finalization_transition_trace pending_block_finalization_transition_trace_header_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_block_finalization_transition_trace
    ADD CONSTRAINT pending_block_finalization_transition_trace_header_hash_fkey FOREIGN KEY (header_hash) REFERENCES public.pending_block_finalizations(header_hash) ON DELETE CASCADE;

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
-- PostgreSQL database dump complete
--

\unrestrict EeYVZGEQXSEdLj0Eg14ExARYEvQoRKK8VA2eSmDosJENQkYqePcs5Nza3dSXbDf


-- ---------------------------------------------------------------------------
-- The state queue, as the node's L1 follower records it.
--
-- Copied from Midgard f4cf28ca100e99f5bc07c7b1ed6e9b936062a44d migrations 0009
-- (node_landed_blocks, node_confirmed_ledger_frontier) and 0014
-- (node_confirmed_merges), with 0018's constraint change applied. The
-- explorer reads the landed headers not yet merged, walked from the confirmed
-- header by their parent links, for the Blocks page's queue view, and the
-- merges and ancestry for where an applied block stands in settlement.
-- ---------------------------------------------------------------------------

CREATE TABLE node_landed_blocks (
  header_hash bytea PRIMARY KEY CHECK (octet_length(header_hash) = 28),
  parent_header_hash bytea NOT NULL CHECK (octet_length(parent_header_hash) = 28),
  parent_utxos_root text NOT NULL CHECK (parent_utxos_root ~ '^[0-9a-f]{64}$'),
  utxos_root text NOT NULL CHECK (utxos_root ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('own', 'foreign')),
  state text NOT NULL CHECK (state IN ('processed', 'removed')),
  applied boolean NOT NULL,
  spent bytea[] NOT NULL,
  produced_outrefs bytea[] NOT NULL,
  produced_outputs bytea[] NOT NULL,
  deposit_ids bytea[] NOT NULL,
  withdrawals jsonb NOT NULL CHECK (jsonb_typeof(withdrawals) = 'array'),
  forced_ids bytea[] NOT NULL,
  tx_ids bytea[] NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (cardinality(produced_outrefs) = cardinality(produced_outputs)),
  CONSTRAINT node_landed_blocks_removed_applied CHECK (state = 'processed' OR applied)
);
CREATE UNIQUE INDEX uniq_node_landed_blocks_processed_parent
  ON node_landed_blocks (parent_header_hash) WHERE state = 'processed';

CREATE TABLE node_confirmed_ledger_frontier (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  header_hash bytea NOT NULL CHECK (octet_length(header_hash) = 28),
  utxos_root text NOT NULL CHECK (utxos_root ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE node_confirmed_merges (
  header_hash bytea PRIMARY KEY CHECK (octet_length(header_hash) = 28),
  parent_header_hash bytea NOT NULL CHECK (octet_length(parent_header_hash) = 28),
  parent_utxos_root text NOT NULL CHECK (parent_utxos_root ~ '^[0-9a-f]{64}$'),
  utxos_root text NOT NULL CHECK (utxos_root ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('own', 'foreign')),
  applied boolean NOT NULL,
  spent bytea[] NOT NULL,
  produced_outrefs bytea[] NOT NULL,
  produced_outputs bytea[] NOT NULL,
  deposit_ids bytea[] NOT NULL,
  withdrawals jsonb NOT NULL CHECK (jsonb_typeof(withdrawals) = 'array'),
  forced_ids bytea[] NOT NULL,
  tx_ids bytea[] NOT NULL,
  consumed_deposit_ids bytea[] NOT NULL,
  finalized_withdrawal_ids bytea[] NOT NULL,
  finalized_forced_ids bytea[] NOT NULL,
  merge_slot bigint CHECK (merge_slot >= 0),
  merge_out_ref text,
  folded_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (cardinality(produced_outrefs) = cardinality(produced_outputs)),
  CHECK ((merge_slot IS NULL) = (merge_out_ref IS NULL))
);
CREATE INDEX idx_node_confirmed_merges_merge_slot
  ON node_confirmed_merges (merge_slot);
