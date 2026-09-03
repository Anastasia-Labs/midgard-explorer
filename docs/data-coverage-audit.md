# Explorer data-coverage audit

This map distinguishes the Midgard node Postgres database from the explorer-owned Cardano L1
index. That distinction is part of the product contract: node data describes current Midgard state;
the L1 index describes what the explorer independently observed on Cardano.

Status values:

- `shown` — exposed through an API and visible in the explorer.
- `indexed-not-shown` — stored and queryable, but not yet presented.
- `needs-indexing` — derivation is possible only after adding a durable index.
- `unavailable-upstream` — the source does not persist enough evidence.
- `delegated-to-cexplorer` — Cardano-wide context intentionally leaves this explorer.

## Midgard node Postgres

| Source DB · table.column | API endpoint.field | Page + section | Test | Status |
|---|---|---|---|---|
| node · `pending_block_finalizations.header_hash,status,block_start_time,block_end_time,submitted_tx_hash,created_at,updated_at` | `/api/blocks/*`, `/api/block` · `header`, `finalization`, `neighbours` | Overview, Blocks, block journey | `block-queries`, `populated`, `block-navigation` | shown |
| node · `pending_block_finalization_txs.header_hash,member_id,ordinal,source_time_stamp_tz` | `/api/block.rows`, transaction inclusion | Block · Transactions; Transaction journey; Address activity | `block-queries`, `populated` | shown |
| node · `pending_block_finalization_deposits.*` | `/api/block.events.deposits` | Block · Protocol events | `block-queries`, `populated` | shown |
| node · `pending_block_finalization_withdrawals.*` | `/api/block.events.withdrawals` | Block · Protocol events | `block-queries`, `populated` | shown |
| node · `pending_block_finalization_forced_transactions.*` | `/api/block.events.forced_transactions` | Block · Protocol events | `block-queries`, `populated` | shown |
| node · `da_payloads.header_hash`, eight roots, six counts, time window | `/api/block.da` | Block · Data availability | `block-queries`, `populated` | shown |
| node · `blocks.height,header_hash,tx_id,time_stamp_tz` | `/api/block`, `/api/transactions/*` | Blocks/transactions legacy height links | `block-queries` | shown |
| node · `immutable.tx_id,tx`, `mempool.tx_id,tx`, `processed_mempool.tx_id,tx` | `/api/transaction`, `/api/transactions/*` · decoded body/status | Transactions; Transaction Overview/State/Datums/Events/Details/Raw | transaction tests, `populated`, `utxo-flow` | shown |
| node · canonical transaction CBOR values | decoded `ValueView` | Transaction values and address movements | decoder/contract tests | shown |
| node · canonical transaction CBOR asset movements over time | none | Asset transfer, mint/burn and supply history | none | needs-indexing |
| node · `mempool_ledger.*`, `confirmed_ledger.*`, `address_history.*` | `/api/address` · balance, UTxOs, paged history | Address · Activity/Assets/UTxOs/Raw | `address-queries`, `populated`, contract tests | shown |
| node · spendable ledger CBOR scan (bounded to 20,000 UTxOs) | `/api/assets`, `/api/asset` · holdings/coverage | Assets; Asset · Holders/Raw | asset tests | shown |
| node · historical ledger snapshots | none | Historical balance and holder snapshots | none | needs-indexing |
| node · `deposits_utxos.*` | `/api/deposits/:page` | Deposits, plus Cardano evidence reconciliation | bridge tests, `populated` | shown |
| node · `withdrawal_utxos.*` plus canonical value/address decoder | `/api/withdrawals/:page` | Withdrawals | withdrawal decoder/tests, `populated` | shown |
| node · `forced_transaction_utxos.*` | `/api/forced-transactions/:page` | Forced transactions | bridge API tests, `populated` | shown |
| node · bridge event/order identifiers | `/api/search`, filtered bridge list endpoints | Search → existing bridge lists | search/catalogue/E2E tests | shown |
| node · admission/rejection/journey timing tables | `/api/transaction`, `/api/metrics` | Transaction journey; Overview metrics | transaction/metrics tests | shown |

## Explorer-owned Cardano L1 index

> `header_hash` in this table means a 28-byte Midgard block header hash, and
> `utxos_root` the 32-byte Merkle root. Until ADR 6 the indexer wrote the root
> into the key, so this row read `shown` while the block page's Cardano evidence
> resolved for no block in the deployment. A status here is only as good as a
> test that reads BOTH sources: `cross-source-identity` is what now backs this
> one, and a row whose only evidence reads one database should not claim `shown`.


| Source DB · table.column | API endpoint.field | Page + section | Test | Status |
|---|---|---|---|---|
| L1 index · `sync_cursor.source,last_block_height,updated_at` | `/api/l1/summary.lastSyncedHeight` | Cardano L1 source status | `l1-routes`, populated L1 tests | shown |
| L1 index · `l1_tx.tx_hash,block_height,block_hash,slot,epoch,tx_time,fee,size,total_output,block_index,cert_deposit,invalid_before,invalid_after,metadata` | `/api/l1/transactions/:page`, `/api/l1/transaction` | Cardano L1; L1 transaction summary/Raw; general ledger detail delegated | `l1-routes`, `l1-transaction` | shown |
| L1 index · `l1_tx_io.kind,position,source_tx_hash,source_index,address,payment_cred,stake_addr,lovelace,datum_hash,inline_datum,ref_script_hash` | `/api/l1/transaction`, `/api/l1/validator` | L1 transaction · UTxOs/Collateral; Validator · UTxOs/History | `l1-routes`, `l1-transaction`, validator tests | shown |
| L1 index · `l1_tx_asset.kind,policy_id,asset_name,fingerprint,quantity` | `/api/l1/transaction.mints` and nested UTxO assets | L1 transaction · UTxOs/Mint & burn | `l1-routes`, `l1-transaction` | shown |
| L1 index · `l1_redeemer.script_hash,address,purpose,mem_units,step_units,fee,datum_hash,datum,valid_contract,script_size` | `/api/l1/transaction.redeemers`, `/api/l1/validator.operations` | L1 transaction · Contracts; Validator · Operations/History | `l1-routes`, `l1-transaction`, validator tests | shown |
| L1 index · `l1_event.tx_hash,validator,event_type,output_index,lovelace,datum,deployment,decoded` | `/api/l1/transaction.events`, `/api/l1/deposits`, validator history | L1 transaction · Events; Deposits · Cardano evidence; Validator · History | indexer/event/L1 route tests | shown |
| L1 index · `l1_block_header.header_hash,l1_tx_hash,block_height` | `/api/l1/block-headers`, `/api/l1/block-header` | Block · Cardano evidence | `state-queue-asset`, `cross-source-identity`, `l1-routes` | shown |
| L1 index · `l1_block_header.prev_utxos_root,utxos_root,withdrawals_root,forced_transactions_root,transactions_root,deposits_root,transition_trace_root,event_to_step_root` | `/api/l1/block-header` roots | Block · Cardano evidence | state-queue + block E2E tests | shown |
| L1 index · `l1_block_header.withdrawal_count,forced_transaction_count,l2_transaction_count,deposit_count,total_event_count,transition_step_count,start_time,end_time` | `/api/l1/block-header` counts/window | Block · Cardano evidence | state-queue + block E2E tests | shown |
| L1 index · `l1_block_header.prev_header_hash,operator_vkey,protocol_version` | `/api/l1/block-header` | Block · Cardano evidence | state-queue + block E2E tests | shown |
| L1 index · distinct block height/hash/epoch from `l1_tx` | transaction APIs only | Dedicated Cardano block/epoch pages | none | indexed-not-shown |
| L1 index · Cardano-wide address, pool, governance and unrelated transaction data | none | CExplorer | external-link tests | delegated-to-cexplorer |

## Application-derived and operational coverage

| Source | API / UI | Status |
|---|---|---|
| Both DBs · exact/prefix identifiers for L2 txs, headers, L1 txs, validators and bridge records; exact indexed address | `/api/search` → universal search | shown |
| L2 asset units/fingerprints and valid Bech32 addresses | deterministic route classification, then endpoint validation | shown |
| CSV export and URL filters | Blocks and Transactions | shown |
| CSV export for deposits, withdrawals, forced transactions, assets and Cardano L1 | none | indexed-not-shown |
| Per-record JSON/API evidence | block, L2 transaction, address, asset, L1 transaction, validator | shown |
| Sorting, date ranges and amount ranges across lists | none | indexed-not-shown (query work; no migration required for basic forms) |
| Public labels, private watchlists, notifications and fiat pricing | none | unavailable-upstream / out of current protocol-explorer scope |

## Next priorities

1. Add CSV export and URL-backed filters to the remaining list pages.
2. Add L1 block and epoch drill-down views from existing `l1_tx` rows if operator investigation needs them.
3. Add a durable L2 asset-movement index before presenting supply or transfer history.
4. Add historical ledger snapshots only with explicit retention and storage budgets.
