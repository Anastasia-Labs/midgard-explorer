-- Minimal L1 index rows for the contract gate.
--
-- The backend-contract test decodes a block detail, which only carries the
-- association envelope when the index holds a header for that block. Without
-- these rows the test correctly refuses to report a pass it never measured, so
-- the gate would be red for want of data rather than for a defect.
--
-- The header and transaction are the SAME anchor block the node seed carries,
-- which is what makes the two sources comparable: the node claims to have
-- settled it, the index claims to have observed it, and the association
-- resolves to `matched` rather than to one side's silence.
INSERT INTO l1_tx (tx_hash, block_height, block_hash, slot, epoch, tx_time,
                   fee, size, total_output, block_index, cert_deposit)
VALUES ('9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92',
        4980661, 'aa', 1, 1, now(), 0, 0, 0, 0, 0)
ON CONFLICT (tx_hash) DO NOTHING;

INSERT INTO l1_block_header
  (header_hash, l1_tx_hash, block_height, prev_utxos_root, utxos_root,
   withdrawals_root, forced_transactions_root, transactions_root, deposits_root,
   transition_trace_root, event_to_step_root, withdrawal_count,
   forced_transaction_count, l2_transaction_count, deposit_count,
   total_event_count, transition_step_count, start_time, end_time,
   prev_header_hash, operator_vkey, protocol_version)
VALUES ('003ab288f3168c80eb09f5843844dc19a506e0177947d2ca22d9ca68',
        '9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92',
        4980661, '', '', '', '', '', '', '', '',
        0, 0, 0, 0, 0, 0, 0, 0, '', '', 1)
ON CONFLICT (header_hash) DO NOTHING;
