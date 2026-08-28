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

Nine full suite executions are recorded below: five passed and four had test
failures. The suite at `3eacacf` passed, but its evidence wrapper exited 1, so
it was not valid gate evidence.

| Run | Result | Failure |
|---|---|---|
| `505066b` | 424 passed, 1 failed | 30s timeout on `page.goto`, `help-affordances.spec.ts:140` |
| `268ac27` run 1 | 424 passed, 1 failed | 90s timeout inside axe `page.evaluate`, `populated.spec.ts:817` |
| `268ac27` run 2 | 425 passed, 0 failed | none |
| audit cleanups, uncommitted worktree | 425 passed, 0 failed | none |
| `4c6a068` | 423 passed, 2 failed | the fixture's relative-time window expired, below |
| `4c6a068` + clock pin | 425 passed, 0 failed | none |
| `8e2d4ba` | 421 passed, 4 failed | four different tests, peak load 94.61 |
| `3eacacf` | 425 passed, 0 failed | none in the suite; the evidence wrapper still exited 1 |
| `24ff9b0` | 425 passed, 0 failed | none |

The failures had two different causes. The `4c6a068` failures were deterministic
assertions caused by the fixture clock crossing its 30-day boundary, and are
fixed by pinning the clock. The failures at `505066b`, the first `268ac27` run,
and `8e2d4ba` were timeouts rather than assertions; the affected tests passed
quickly in isolation, while the `8e2d4ba` run recorded severe resource
exhaustion.

It is not proved, and the difference matters. The logs sampled load and free
memory **once, at the start**, and the first failing run started at load 2.81
with 2.4 GiB available, which looks healthy. What the machine did during the
eleven minutes that followed was never recorded, so the resource explanation is
the likely one rather than the evidenced one.
`frontend-new/scripts/gate-evidence.sh` now samples throughout and records the
peak, so the next failure is attributable instead of argued about. A clean run
on hosted CI against an immutable pushed SHA would settle it better than any
further local run, and that needs a push.

Backend: **440 passed, 8 skipped, 0 failed** across 49 files, every step exit 0,
under the documented command with `REQUIRE_DB=1`. Recorded in
`.git/gate-evidence/4c6a068-backend.log` against sha `4c6a068` with a clean
worktree, so the log proves the commit it names rather than a worktree that
merely started from one.

The 8 skipped are the whole of `test/live-validation.test.mts`, which is
`describe.skipIf(!LIVE)` and reaches live Koios and the node's database. They
are opt-in by design, not quarantined: `LIVE_E2E=1 pnpm vitest run
test/live-validation.test.mts` runs them, and `backend/scripts/live-evidence.sh`
is what runs them for the record.

Frontend: **425 passed, 17 skipped, 0 failed** of 442, plus 435 unit tests
(420 app, 12 contracts, 3 ui), every step exit 0. The 17 skipped are
viewport-conditional cases that a project skips when they do not apply to it.

The sampler recorded peak load 5.00 and a floor of 1.2 GiB available across the
6.2 minute e2e run, and it passed at that floor with a headless Playwright MCP
browser also resident. That is one clean run under measured pressure, not proof
the timeouts are gone. Five of the nine historical suite executions listed above
passed. Current-tip gate results are recorded in the local evidence file and,
after publication, the hosted CI artifacts.

### The suite had an expiry date

The run at `4c6a068` failed twice on one assertion, on both projects, with
identical pixel values:

```
deposits table needs internal scrolling at desktop width: 1465px > 1390px
```

It reads as a stylesheet regression. It is a calendar. Every timestamp in
`e2e/fixtures/data.mjs` is built from one fixed instant, `Date.UTC(2026, 6, 28)`.
`relativeTime` renders an age up to 30 days as `Nd ago` and anything older as a
full `YYYY-MM-DD HH:MM:SS UTC` string, roughly three times the width. The
fixture crossed 30 days overnight, the timestamp column widened, and the table
began overflowing its container on every machine, permanently.

The same tree passed this test hours earlier, which is the tell: nothing in the
tree changed, so the input that changed was outside it.

`test/format.test.ts` did cover the beyond-30-days branch, using a date 208 days
old. That proved the branch existed without ever locating its edge, so the edge
was free to arrive unannounced. It now has 29, 30 and 31 day cases and one
asserting the absolute form is more than twice the width of the relative one,
which is the property that breaks the layout.

The fix pins the browser clock in the shared `test` fixture in `e2e/helpers.ts`
rather than re-anchoring the data, which keeps the fixture byte-identical: a
fixture built from a fixed instant is only deterministic when it is read
against a fixed instant.

The class is contained rather than assumed contained. The codebase has exactly
one age threshold, `lib/format.ts:43`, and one fixture anchor. The backend
renders no relative time, so it cannot carry this defect.

### `REQUIRE_DB=1` is the whole difference between a real result and a believed one

The same worktree run *without* the flag reported no failures at all. With it,
three tests failed: `indexer-sync-atomicity` twice and
`indexer-deployment-sweep` once, each a 5s timeout rather than an assertion.

`syncOnce` takes six injectable fetch seams and those three call sites stubbed
four, so `fetchAccountUpdates` and `fetchEpochParams` fell through to the live
Koios API. The suite was reaching the network, and the failures carried
`fetch failed` and `Koios 429 rate limited` to say so. `deps` is
`Partial<SyncDeps>`, so omitting a seam is type-legal and nothing flagged it.

The three call sites now stub all six, matching `indexer-sync.test.mts` and
`indexer-reconciliation.test.mts`. The suite runs 15s faster for no longer
waiting on Koios, and the count did not move because those three were passing
without the flag all along.


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

## What the migrations do to an existing index

Two migrations in this branch change data rather than only shape, and one of
them is destructive. Read this before upgrading any database that holds rows.

### `20260807164120_tx_detail` deletes every row in `l1_tx`

It adds five required columns with no default, which Postgres cannot do to a
populated table, so the migration clears the table first and the indexer
re-fetches the rows from Koios. The delete cascades to `l1_event`.

This runs **only where that migration has not already been applied**. Check
before upgrading:

```sql
SELECT migration_name, finished_at, rolled_back_at
  FROM "_prisma_migrations"
 WHERE migration_name IN ('20260807164120_tx_detail',
                          '20260827120000_deployment_attribution_repair')
 ORDER BY migration_name;
```

A row with `finished_at` set and `rolled_back_at` null means that migration is
already applied and its delete will not run again. A missing row on a populated
database means the upgrade needs a maintenance window: the index is emptied and
rebuilt from genesis, the deployment stays out of rotation for the whole
re-index, and readiness stays red until the cursors reconcile. How long that
takes depends on the chain range and Koios throughput, so measure it in the
target environment rather than assuming this one's figure.

Measured on the local index on 2026-08-28: `tx_detail` applied and finished,
230 rows in `l1_tx`, 246 in `l1_event`, all three cursors agreeing at 5107562,
and every event attributed to the manifest identity with none under `default`.
On that index the repair migration below is a no-op.

### `20260827120000_deployment_attribution_repair` resets cursors, and only sometimes

It drops the column default so a writer cannot omit the deployment again, then
resets the three L1 cursors **only if** at least one event is still attributed
to `default`. On an index with no mis-attributed rows the update matches nothing,
so the migration is safe to apply to a fresh deployment and safe to re-run.

### Recording and rollback

Record before and after: the two migration rows above, the counts from `l1_tx`
and `l1_event`, the three `sync_cursor` values, and the attribution breakdown by
deployment.

Rollback is restoring the pre-migration backup. The deleted rows are derived
from the chain and are not reconstructible by hand, so a backup that has been
proven restorable is the only way back.

Do not edit either migration to soften this. Both are applied to persistent
databases, and changing a file Prisma has already recorded produces a checksum
mismatch that blocks every later migration.

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

### Rehearsal 5: the signal handlers

Releasing the lock in a trap that RETURNS is not the same as handling the
signal. Bash carries on from where the signal interrupted it, so
`trap release_lock EXIT INT TERM` would have released leadership on a SIGTERM
between the confirmation and `indexer:deploy`, then run the migration anyway,
unprotected: the mechanism meant to prevent the two-writer state reaching it by
itself. The handlers release and then exit, with the conventional 128+signal
status so a supervisor can tell an interrupted rollout from a refused one.

The same cleanup also silenced the shell. `exec` with only redirections applies
them to the shell and they persist, so `exec 9>&- 2>/dev/null` closed fd 9 and
sent every later error to `/dev/null`, which would have made a failure after the
release invisible. Closing an fd that is not open is not an error in bash, so
the suppression bought nothing and cost the diagnostics.

| Test | Result |
|---|---|
| SIGINT while holding the lock | exit **130**, migration not applied, 0 advisory locks, zero occurrences of `Applying migration` |
| SIGTERM while holding the lock | exit **143**, migration not applied, 0 advisory locks, zero occurrences of `Applying migration` |
| SIGKILL while holding the lock | exit **137**, 0 advisory locks, migration not applied |
| A normal `--apply` | Lock trace sampled four times a second reads `0 1 0`: free before, held for the whole migration, free after. Migration applied, 141 transactions and 158 events preserved |
| Errors after the release | `ERROR: relation "l1_tx" does not exist` appears in the output, from a command that runs after leadership is released |

One harness note worth keeping: a background child of a non-interactive shell
has SIGINT set to `SIG_IGN`, and a signal ignored on entry cannot be trapped. A
first run therefore showed the INT handler doing nothing, which was the harness
disarming it rather than the script failing. With job control enabled the
handler fires. An operator pressing Ctrl-C in a terminal is the job-control
case.

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
