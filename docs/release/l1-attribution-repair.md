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
| Relationship to `develop` | `develop` is an ancestor of HEAD, behind by 0, so there is nothing to rebase |
| Commits ahead of `develop` | recount with `git rev-list --count develop..HEAD` rather than trusting a number here. A count written into this file is stale the moment the commit writing it lands, which has already produced one off-by-one correction |
| Pushed | no. No remote contains this HEAD |
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
| `5838c42` | Readiness refuses an index that has not finished a reconciliation |
| `4847361` | The rollout script's target is the URL Prisma migrates through |
| `7466552` | Every advisory disposition carries an owner and an expiry |
| `c5949fa` | Images pinned by digest, actions by SHA, gate output kept as artifacts |

## Gates

| Gate | Command |
|---|---|
| Backend | `REQUIRE_DB=1 pnpm typecheck && pnpm build && pnpm run audit:gate && pnpm test` |
| Frontend | `frontend-new/scripts/ci-local.sh` |

Each is run as one continuous run against a clean worktree, and its output is
written to `.git/gate-evidence/<short-sha>-{backend,frontend}.log` with the
commit and the exit code of every step. A document cannot carry the result of
the gate that runs on the commit introducing it, so the counts below are the
last measured run and the evidence files are authoritative.

CI is configured to upload the same output as artifacts
(`backend-gate-evidence`, `frontend-gate-evidence`) on success as well as
failure. **That configuration has never run.** The branch is unpushed, no remote
contains this HEAD, and no artifact exists. Until a run happens the evidence is
local only, and the upload itself is unproven; the first push is what tests it.

A re-run that passes does not convert a failed run into a green one. Only a
single clean run counts, and a run that failed is recorded rather than
discarded.

### The frontend gate is not yet reliably green

Three full runs, two failures:

| Run | Result | Failure |
|---|---|---|
| `505066b` | 424 passed, 1 failed | 30s timeout on `page.goto`, `help-affordances.spec.ts:140` |
| `268ac27` run 1 | 424 passed, 1 failed | 90s timeout inside axe `page.evaluate`, `populated.spec.ts:817` |
| `268ac27` run 2 | 425 passed, 0 failed | none |

Neither failure was an assertion, they were different tests, and both cases pass
in under six seconds in isolation on an idle machine. That points at capacity on
a two-core box rather than at the product.

It is not proved, and the difference matters. The logs sampled load and free
memory **once, at the start**, and the first failing run started at load 2.81
with 2.4 GiB available, which looks healthy. What the machine did during the
eleven minutes that followed was never recorded, so the resource explanation is
the likely one rather than the evidenced one.
`frontend-new/scripts/gate-evidence.sh` now samples throughout and records the
peak, so the next failure is attributable instead of argued about. A clean run
on hosted CI against an immutable pushed SHA would settle it better than any
further local run, and that needs a push.

Backend: **402 passed, 8 skipped, 0 failed** across 47 files, every step exit 0.
The 8 skipped are the whole of `test/live-validation.test.mts`, which is
`describe.skipIf(!LIVE)` and reaches live Koios and the node's database. They
are opt-in by design, not quarantined: `LIVE_E2E=1 pnpm vitest run
test/live-validation.test.mts` runs them, and `backend/scripts/live-evidence.sh`
is what runs them for the record.

Frontend: **425 passed, 17 skipped, 0 failed** on the run of record. The 17
skipped are viewport-conditional cases that a project skips when they do not
apply to it.


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

Run twice, each time against a `pg_dump` copy of production restored into a
separate database that was dropped afterwards. Production was never written to,
and its counts were re-read at the end of each run to prove it.

The second rehearsal is the one that matters, because it is the one that
exercises the deployment mechanism rather than only the migration. Every step
below is a recorded exit code, not a description.

| Step | Result |
|---|---|
| `rollout.sh --check`, un-migrated | **exit 1**, naming the missing migration and the 158 unreachable rows |
| `rollout.sh --apply` while a writer held the leadership lock | **REFUSED, exit 1.** The migration was not applied |
| `rollout.sh --apply` with the lock released | Migration applied to the database it had just inspected, by name. Column default dropped, cursors reset to 0, **141 transactions and 158 events preserved**, nothing deleted |
| `rollout.sh --check`, migrated but not yet re-indexed | **exit 1.** The schema probes pass and the reconciliation probe refuses. This is the interval the first rehearsal reported as ready |
| One writer, from the compiled `dist/index.js` | Full re-index from height 0, in about a minute |
| `rollout.sh --check`, after one reconciled pass | **exit 0.** 225 transactions, 241 events, **zero rows under `default`**, one deployment row, three cursors equal at 5106529 |
| SIGTERM | Exited in 1 second. Zero advisory locks left on the database, and the lock re-acquirable by a fresh client, so leadership was released rather than leaked |

Production was re-read immediately afterwards and still holds 141 transactions,
158 events all attributed `default`, and cursor `l1` at 5082691.

One detail worth keeping: the refusal in step 2 happened twice, the second time
unintentionally. The process holding the lock was started inside a shell
subshell, and killing the subshell did not kill the `psql` session inside it, so
the lock stayed held. That is exactly the situation the preflight exists for: a
writer an operator believes they stopped.

### Rehearsal 4: the preflight became a reservation

The check above proved leadership was free at one instant and reserved nothing.
The `psql` that answered closed and released, so a supervised writer could be
restarted into the gap between the answer and the migration. `--apply` now takes
the lock and holds it across `indexer:deploy`, on an idle session.

| Test | Result |
|---|---|
| `--apply` while a real writer holds leadership | REFUSED, exit 1, migration not applied |
| A writer started while the rollout holds the lock | Logged `L1 sync not started: another process holds the indexer lock`, and indexed nothing: `l1_tx` unchanged at 141 |
| The holder session's state | `idle`, which is the property the design turns on |
| The migration itself, under the held lock | Applied, 141 transactions and 158 events preserved, lock released, 0 advisory locks after |
| The rollout SIGKILLed while holding the lock | 0 advisory locks afterwards, lock re-acquirable. No trap runs on SIGKILL; the fd closing is what releases it |

Two defects were found by running this rather than reasoning about it, and both
are the kind that reads as correct on the page:

- Holding the session open with `SELECT pg_sleep(1800)` does not work. Killing
  `psql` closes the socket, but PostgreSQL only notices a departed client when
  the backend next writes, and one inside `pg_sleep` will not for half an hour.
  Measured: `psql` gone, `pg_stat_activity` still `active`, lock still held. An
  idle session is what makes a departed client noticed immediately.
- `psql` inherited the shell's fd 9, so it was itself a writer on the FIFO it
  was reading and EOF could never arrive. A SIGKILLed rollout left leadership
  held on a database with no process visibly holding it. `9>&-` on the child is
  the fix.

### One incident, recorded

During rehearsal the harness invoked `rollout.sh --apply` without overriding
`INDEXER_POSTGRES_URL`, so the script resolved `.env` and targeted **production**.
Nothing was migrated. The confirmation asks for the full `host:port/database`,
the harness typed the rehearsal database, and the script aborted. That control
was added because naming the database alone cannot tell two hosts apart; it
turned out to also be what stands between a mistyped harness and the live index.

The SIGKILL that followed left an orphaned holder session on production, which
was terminated. Production was verified before and after: 141 transactions, 158
events under `default`, cursor 5082691, the column default intact, the repair
migration unapplied, and zero advisory locks. The rehearsal harness now refuses
to run unless the resolved target is the rehearsal database.

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
