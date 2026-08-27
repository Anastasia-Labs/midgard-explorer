# Release record: L1 deployment-attribution repair

The evidence for the indexer correctness work on `wip/remediation`, kept in the
repository because the local `.git/gate-evidence/` directory is never pushed and
a reviewer cannot read it. Every figure here was produced by a command named
alongside it. Nothing has been pushed, merged, or applied to production.

## Identity

| | |
|---|---|
| Branch | `wip/remediation` |
| Base | `develop` at `0c04d18a05857f4be00e2d17839ecf6d464d3266` |
| Commits ahead of `develop` | 132 |
| Commits in the branch's whole history | 168 |
| Network | Cardano preprod |
| Chain source | Koios `https://preprod.koios.rest/api/v1` |
| Manifest | the tx-validation deployment's `contract-deployment-info.json` |
| Manifest identity | `a56045c3133c4bfa52714c3371b46afedff7de450df53e213866aa79b5c5f7fd` |

The manifest identity is recomputed from the document and compared against the
`manifestId` it declares, rather than accepted on shape. The algorithm is a
sha256 over key-sorted JSON of a subset of the document, ported from the tool
that writes it and conformance-tested against the real deployed file, which is
checked in at `backend/test/fixtures/manifest-deployed-preprod.json`.

## The commits that carry the behaviour

The two worth the closest reading are the first two: they change what is
indexed and when the index may be rewritten.

| Commit | What changed |
|---|---|
| `88b0db0` | Manifest identity is verified; all 40 entries are retained; scan targets deduplicate by purpose AND hash, so a multi-purpose script no longer loses a purpose |
| `4938da6` | Every source reconciles from one shared floor, and the reorg window is deleted only when every source completed |
| `179fe46` | HTTP and the indexer drain together on shutdown |
| `59f1842` | Readiness reports a migration this build ships that the index has never applied |
| `8a099c1` | The audit gate fails closed when the audit did not run |
| `0270243` | Withdraw execution indexing, as hermetic integration coverage |
| `9ce6482` | The trusted proxy is named rather than counted by hop |
| `ee9a260` | The database-wide revoke is separated from creating the reader role |
| `0641cd6` | CI runs `audit:gate`, not pnpm's builtin `audit`, which shadowed it |
| `d00792c` | The CI node fixture carries the 18 relations the read path queries, not 7 |
| `49b7b15` | Live evidence is captured by the run that produces it |
| `6449f6d` | The rollout is a script, in the order it was rehearsed |

## Gates

Run on the exact HEAD recorded in each row, in a single continuous run each.

| Gate | Command | Result |
|---|---|---|
| Backend | `pnpm typecheck && pnpm build && pnpm run audit:gate && pnpm test` | typecheck, build, audit and tests all exit 0 |
| Frontend | `frontend-new/scripts/ci-local.sh` | exit 0, "Gate green" |

Backend tests: **402 passed, 8 skipped, 0 failed** across 47 files. The 8 skipped
are the whole of `test/live-validation.test.mts`, which is `describe.skipIf(!LIVE)`
and reaches live Koios and the node's database. They are opt-in by design, not
quarantined: `LIVE_E2E=1 pnpm vitest run test/live-validation.test.mts` runs
them, and `backend/scripts/live-evidence.sh` is what runs them for the record.

Frontend tests: **425 passed, 17 skipped, 0 failed**.

CI uploads both jobs' output as artifacts on success as well as failure
(`backend-gate-evidence`, `frontend-gate-evidence`), so the same figures are
readable by anyone with access to the run.

## Live validation

Indexed from live preprod through Koios into a test index, at
`c6d91df565d19dc0353aec4da6603025813b1d48`.

| Table | Rows |
|---|---|
| `l1_tx` | 224 |
| `l1_event` | 240 |
| `l1_tx_io` | 2201 |
| `l1_redeemer` | 254 |
| `l1_block_header` | 9 |

Attribution: one row, `a56045c3133c4bfa52714c3371b46afedff7de450df53e213866aa79b5c5f7fd`,
240 events. None under `default`.

Cursors: `l1`, `l1:mints` and `l1:rewards` all at height **5106392**, which is
the shared floor working: the three advance only inside a pass where every
source completed.

Redeemer purposes: spend 211, mint 32, cert 11.

### Representative transactions

Full hashes, because a truncated hash cannot be looked up.

**Spend** at height 5106392
`e8d81ff2008a31afd2b862cc85dd91d93988eb2c02cddc78b295266885462ddd`
script `e422840fd9bcb99537e4cc569fe1f3606b2d0e668f079e7e91bb4b18`

**Mint** at height 5105260
`14e2d7a37c9e3e9f42dd80dbdcbc70eae95915a7d2e565530b776457f262ab54`
script `0ccf8d1c17a606a898194617a46409879b39afd1ee33e07377f937ba`

**Mints reachable only through the restored policy scan.** These were invisible
before `88b0db0`, because hash deduplication dropped the Mint purpose of two
multi-purpose scripts:

- `f24d1e8e55f85a17d9a2a04138a88fc7a9f95e400e2a268388144446ba102683` at 4939843,
  policy `008c416cdcfe3081a32202a605b777e3790947cdd00900cf72343958`, asset
  `4d4944474152445f44415f504152414d53`
- `3c1d44ea03149fca6cfea85b63d3c4180e86725f0d17ae56039b38cfb198e8bd` at 5050809,
  same policy, same asset
- `3c1d44ea03149fca6cfea85b63d3c4180e86725f0d17ae56039b38cfb198e8bd` at 5050809,
  policy `65976139558770f54efbe6a16cc2ae078007e347c2bff6e8e9f3a948`, asset
  `4441415449f3a1979a135c7aa1637d6841c27fdcd57799cbb63b4a4739fa6bf5`

**Withdraw.** There is no live withdraw execution to show. Stated precisely:
**no Withdraw execution exists for this deployment's indexed reward accounts
through height 5106392.** `l1_redeemer` holds 0 rows with purpose `reward` at a
maximum indexed height of 5106392. The single reward account this manifest
declares has exactly one account update, a stake registration, in
`75e2b7d9e2a1b8badd635a29b74e08975a72ef6574718e59eb1c538b6b60b7ef` at height
4885839 (epoch 298), with no withdrawals and no Plutus contracts. That
transaction is proof the reward-account discovery source works; it is not proof
that a withdraw execution is indexed. Proving that requires a chain mutation, so
the coverage for it is hermetic, in `backend/test/withdraw-execution.test.mts`.
This claim is about this deployment's reward accounts, not about Cardano.

## Rollout rehearsal

Run at `49b7b15` against a `pg_dump` copy of production restored into a separate
database. Production was never written to. All seven steps passed:

1. Readiness on the new build without the migration: NOT READY, naming the
   missing migration
2. `pnpm indexer:deploy`: column default dropped, cursors reset to 0,
   **141 transactions and 158 events preserved**, nothing deleted
3. Readiness after: the schema probes pass
4. One writer, from the compiled `dist/index.js`: full re-index from height 0
5. **141 to 224 transactions, 158 to 240 events, zero rows left under
   `default`**, one deployment row, three cursors equal
6. SIGTERM: clean drain in 2 seconds, no forced exit
7. The advisory lock is re-acquirable by a fresh client, so leadership was
   released rather than leaked

## Production state

Unchanged. 141 transactions, 158 events all attributed `default`, cursor at
5082691, and the repair migration unapplied. Readiness therefore reports 503 for
this deployment, which is the intended answer: every one of those 158 events is
unreachable by every query the interface makes.

## Running the rollout

`backend/scripts/rollout.sh` performs the migration step in the rehearsed order.
It reads its target from `INDEXER_POSTGRES_URL`, the same variable Prisma
migrates through, so what it inspects and what it migrates cannot differ. It
refuses to migrate while any process still holds the indexer's advisory
leadership lock, and it requires the full `host:port/database` to be typed back.

    ./scripts/rollout.sh --check    # read-only; exits non-zero unless ready
    ./scripts/rollout.sh --apply    # migrates, after the preflight

Keep the deployment out of rotation for the whole re-index. Readiness reports
NOT READY until no rows remain under `default` and all three cursors have
advanced past zero, which together are the durable record that one full
reconciliation committed.
