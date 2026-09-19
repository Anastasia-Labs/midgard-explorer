# Production readiness audit

Audited 2026-09-17 on `wip/dev-onboarding` at `86043a5d`, worktree clean, 76
commits ahead of `origin/wip/dev-onboarding`, nothing pushed. Every figure below
says whether it was produced by a fresh run in this session, read from an
artifact already on disk, or carried over from an earlier record.

This audit does not replace the programme register. `performance-budgets.md`
remains the authority on every latency, database, payload, resource, CI and
codebase-health row, and this page reconciles to it rather than restating it.
What this page adds is the five areas that register does not measure:
correctness invariants, security, developer experience, usability and
accessibility, and the state of the gates themselves.

The initial audit changed no application code. Follow-up remediation and its
verification are recorded below; the initial snapshot is not the current tree.

## 1. Executive verdict

**What was found in good order.** The product is built. Every correctness
invariant checked at the money layer held, in each path reviewed. Every security
control reviewed held. The accessibility result is the strongest evidence this
audit produced. The developer surface is well built out. The backend passed its
whole gate on the day: type check, documentation gate, coverage lint, 813 tests
against a real database, 51 development-command tests, and the advisory gate.

**What was not.** The branch did not pass the local gate that mirrors continuous
integration, `frontend-new/scripts/ci-local.sh`, and had not since `0bf26a8c` on
2026-09-16. That script stopped at step three of eleven, so it never reached the
type check, the unit tests, the production build or the browser suite. Nothing
is pushed and no workflow records were consulted, so this states nothing about
hosted runs. Two list routes push the page sideways at the most common desktop
width. The documented memory minimum is wrong for the most-visited page in the
application, by a factor of about 2.5. Web Vitals cannot be collected in one of
the two documented deployment shapes.

**Status since this audit was written.** The audit records the state at
`86043a5d`. Two findings have been acted on since, and their results are in
section 6 rather than here:

- **B1** is fixed and committed. The ten files were formatted and the two unused
  imports removed.
- **M7** is implemented. The gate now runs one production build per full run,
  with strict configuration enabled in Playwright’s build. The proposed
  source-pattern wiring check was superseded; see section 3.3, M7.
- **The full frontend gate now passes**, exit 0, after the final M7 change and
  an authorized pause of Cardano node, Ogmios and Kupo. Browser results:
  475 passed, 19 skipped, zero failures. This closes the current gate execution
  gap; it does not settle the separate audit findings or prove the cause of
  earlier intermittent failures. See section 6.

**What prevented a defensible production-readiness claim at the audit
snapshot.** The first item is now resolved for the tested working tree; the
remaining items are still open.

1. **The gate is red.** The repository's CI-equivalent script is the acceptance
   gate, and it exits at the formatting step, so one pass of the whole script
   has not happened. This does not invalidate the checks that did run: the
   backend gate passed in full, and the frontend type check and all three unit
   suites passed when invoked directly. What is missing is the single end to end
   run, which is also the only thing that exercises the production build and the
   browser suite together.
2. **Four of the eleven dimensions in the stated definition of done are still
   failing or unmeasured against the artifacts that exist**: backend peak
   resident memory, two of twelve target workloads, nine of twelve stress
   workloads, and four continuous integration measures that are either failing
   or below the sample size their own targets name. Every one of those figures
   is historical, and section 3.6 reconciles them against the later results.
3. **The definition of done has no security, correctness or accessibility
   criterion.** This is the most consequential finding in the audit. The eleven
   dimensions in `superpowers/plans/2026-09-04-explorer-budgets-and-coverage.md`
   are all performance, delivery, test and coverage dimensions. Every finding in
   sections 3.1 to 3.4 below could be outstanding and every stated condition for
   "10/10" could still be met, because no row measures them. A score computed
   against that definition would be true and would not mean what a reader would
   take it to mean.

**Distance to the stated definition of done.** The plan requires any rating
stated before `FINAL-VERIFICATION` to be labelled a forecast, so no distance is
stated here as a single figure. The remaining work sorts into three kinds, and
they are not the same size.

**Bounded and specified.** The gate repair, the two-route overflow, the page
depth cap, the frontend advisory gate, the skip-link focus target and the
fixture-conditional skips. Each has a named remedy and a named acceptance check.

**Open, with the cost unknown until measured.** Backend peak resident memory has
no identified mechanism, and identifying it is a measurement task whose result
decides how large the fix is. Stress behaviour fails nine of twelve workloads on
an artifact that predates three fixes, and nobody knows what a rerun reads. The
security boundaries this audit did not exercise, the dependency tree beyond the
advisory gate, the nginx edge in operation, and anything a penetration test
would reach, are unassessed rather than assessed as sound. **None of these
should be assumed small.** Each could turn out to be a line of configuration or
a structural change, and the honest position is that the audit cannot yet tell.

**Not closeable from inside this repository.** The upstream index (`UR-1`) and
the continuous integration sample sizes, which need calendar time rather than
work.

## 2. Area scorecard

### Rubric

**No numeric scores.** An earlier draft of this work carried per-area numbers out
of ten. They were withdrawn because they had no defined rubric, they merged
claims of different kinds into one figure, and a number gets quoted without the
caveat that produced it. "7 against 8" is not a decision anyone can act on. A
verdict plus the next acceptance check is.

Each area carries one of four verdicts.

| Verdict | Meaning |
|---|---|
| **Verified** | An acceptance criterion exists, and a fresh run or a named artifact meets it |
| **Partial** | A criterion exists, the checks that ran pass, and named gaps remain |
| **Failing** | A criterion exists and a measurement does not meet it |
| **Unmeasured** | No criterion, or a criterion whose current state no available measurement establishes. This is not a pass |

**Unmeasured is not a passing verdict, and it is not a failing one.** It says the
question is open. Where an area is partly unmeasured the untested scope is
stated, because an area is only as strong as the part that was exercised.

**Scope language matters.** Where this page says something was not found, it
means not found in the surfaces reviewed, which are named. That is not the same
as establishing absence across the system, and nothing here should be read as
the stronger claim.

### Scorecard

| Area | Verdict | What the evidence shows | Confidence | Untested scope |
|---|---|---|---|---|
| Correctness and data integrity | **Partial** | Money is `bigint` in the backend, a branded decimal string on the wire, and `BigInt()` in the browser. No float arithmetic on any amount in the reviewed paths. Balance reads every UTxO while only a page is returned and decoded. The UTxO cursor is validated with an even-length hex pattern at the route. History and UTxOs share one snapshot. Backend suite 813 passed with `REQUIRE_DB=1` | High for what was read | Conflicting-source reconciliation was not exercised against live data. The L1 indexer ingest paths were read, not run. No property-based test of the decoder against malformed CBOR |
| Security | **Partial** | No injection path found in the surfaces reviewed, which were every file in `db/` and `indexer/`: each `$queryRaw` is a tagged template, and the five `$queryRawUnsafe` sites bind `$n` placeholders with module constants. Nonce CSP with `strict-dynamic`, proved by a negative browser test that injects an unauthorised script. Read-only sessions set in code. CORS refuses `*` at boot in production. Rate limit keyed on the socket peer by default. Advisory gate passes fresh: three advisories, all with recorded dispositions | High for the surfaces read | No penetration test. No review of the transitive dependency tree beyond the advisory gate. The bundled nginx edge was read, not exercised. Nothing here establishes that no injection or exposure path exists elsewhere in the system |
| Performance and resource efficiency | **Unmeasured** | Current target and scale readiness is unverified pending reproducible measurements. Two separate bodies of evidence exist and neither settles the present state. **Historical failures, from artifacts:** `target-efc9af69.json`, 2026-09-05, records peak resident memory 737.3 MB against 512 MB and two of twelve `target` workloads failing; `stress-5ded259a.json`, 2026-09-16, records nine of twelve `stress` workloads failing. **Reported improvements, artifacts unavailable:** 682.6 MB peak resident memory and passing target workloads. Section 3.6 keeps them apart | High that each body of evidence says what it says. The current state is open | No measurement available to this audit describes the head. Compression was re-enabled at the edge and has no baseline. Two register rows remain `DISCOVERY` |
| Test coverage and quality | **Partial** | 163 test files and 1,361 passing tests: 813 backend with `REQUIRE_DB=1`, 497 app, 51 development-command, 12 contracts, 3 tokens. The corpus contains genuinely discriminating tests, including a CSP test that injects an unauthorised script and first asserts the injection happened, so "it did not run" cannot pass vacuously, and a global setup that names three false-green traps it exists to prevent | High | Five benchmark self-test files never run in CI. Five browser tests skip on fixture content rather than asserting it. Six indexer test files skip when the database is unreachable even with `REQUIRE_DB=1` |
| Gate completeness and reliability | **Current full run passes; reliability limits remain** | Assessed separately from the corpus above, because the two have different remedies and were in opposite states. The gate rejected the branch for eleven commits on formatting and lint. Two scripts named `check` do different things, so a green in the inner package is not the gate. The gate compiled the application twice | High | Section 6 records a full passing run with L1 paused. M6 command mismatch and the resource-contention limit remain |
| Maintainability and code quality | **Partial** | Type check clean across four packages. Duplication 0.90% against a 1.0% target. Dead weight inventoried and decided. 8 decision records, 3 release records | High | Change complexity is a recorded `FAIL`. Transaction status is derived in three places, one with an unreachable branch |
| Developer experience and operations | **Partial** | The one-command demo works exactly as documented: no backend, no Docker, no database, no secrets, ready in 521 ms. Documentation gate passes. `pnpm doctor`, the four readiness probes and the rollout script each carry their own reasoning | High | A genuinely fresh clone and install was not performed. The full stack mode is documented as not measured and remains so. The documented memory minimum is wrong for the transaction route |
| Usability and accessibility | **Partial** | 76 page loads across 19 routes, two themes and two viewports: **zero axe violations** under `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. Zero unnamed interactive elements. One `h1`, one `main` and a working skip link on every page. A visible 2 px focus outline on every one of fourteen keyboard stops. Correct `tablist` semantics. Real 404 status codes | High for the automated and keyboard evidence | No testing with a real assistive technology. Automated checks do not cover WCAG 2.2 target size, which L2 records as failing. Contrast was checked as rendered by axe, not token by token |
| Simplicity and clarity | **Not separately assessed** | This audit did not treat simplicity as its own dimension and collected no evidence against a simplicity criterion. Observations that touch it sit under maintainability and usability | n/a | All of it. No verdict is offered |

**Where these verdicts stand on 2026-09-18.** The table above is dated evidence
from 2026-09-17 and is left as it was read. Six of its rows have moved since,
and section 3.8 carries the evidence for each:

| Area | Then | Now |
|---|---|---|
| Security | Partial, no frontend advisory gate, `indexer/` among the surfaces read | Both workspaces gated; three advisories in the frontend fixed rather than accepted; `indexer/` is deleted and `db/cardanoActivity.ts` post-dates the review, so the new files are a delta review still owed |
| Performance and resource efficiency | Unmeasured | Measured at this head: 13 of 13 target workloads pass, peak resident memory 669.4 MB against a 512 MB budget. The breach is open as M5; stress is blocked on disk |
| Test coverage and quality | 1,361 tests, five fixture skips, six indexer files skipping under `REQUIRE_DB` | 582 backend, 475 app, 41 development-command. The indexer files are deleted and their skips with them; the five fixture skips are assertions |
| Gate completeness and reliability | Two `check` scripts, one weaker | `pnpm check` inside `app` runs the gate itself |
| Usability and accessibility | Overflow at 1280, target size recorded as failing | No sideways scroll on seven routes at four widths in both themes; target size measured at 43 x 43 px and asserted |
| Developer experience and operations | Documented memory minimum wrong | Restated from a measured floor, with the transaction route in both the ceiling set and the sweep |

### Next acceptance check per area

One check per area. Each is the smallest thing that would move the verdict.

| Area | Next acceptance check |
|---|---|
| Correctness and data integrity | A decoder test over malformed and unknown-variant CBOR that fails when the isolation is removed, plus one reconciliation case exercised against conflicting sources |
| Security | An advisory gate covering `frontend-new` that fails on an undispositioned advisory, and a depth cap that answers 400 without issuing a database statement |
| Performance and resource efficiency | The canonical target rerun at the current head, producing one artifact that carries `peakRssBytes` and a verdict per workload. Until that artifact exists the verdict stays `Unmeasured` |
| Test coverage and quality | The five fixture-conditional skips assert their precondition, and the benchmark self-tests either run in a workflow or are recorded as a named pre-baseline checklist |
| Gate completeness and reliability | One full run of `./scripts/ci-local.sh` from `frontend-new` completing every step, on a machine with the headroom to do it |
| Maintainability and code quality | One exported status function with three callers, and the unreachable branch removed |
| Developer experience and operations | The ceiling matrix and the peak sweep include the transaction route, and the per-mode minimum is restated from what they produce |
| Usability and accessibility | Page width is not exceeded at 1280 px on `/deposits` and `/withdrawals`, with an assertion at that width that fails when the fix is reverted |
| Simplicity and clarity | Decide whether this is a dimension worth a criterion. If it is, define one before assessing it |

## 3. Prioritized findings register

Severity is the consequence if left alone. Confidence is how sure the evidence
makes it. They are separate on purpose. Evidence is marked **reproduced** (a run
in this session), **source-confirmed** (read in the code), **artifact** (read
from a file already on disk), or **hypothesis**.

### 3.1 Release blocking

#### B1. The branch fails its own continuous integration gate

- **Area** Developer experience. **Severity** High. **Confidence** High.
  **Evidence** Reproduced.
- **What.** `frontend-new/scripts/ci-local.sh`, run from `frontend-new`, runs
  under `set -euo pipefail`. Step three, `prettier --check .`, fails on ten
  files. Step four, `eslint .`, fails with two errors: `Chip` and `Detail` are
  imported and never used in
  `../frontend-new/app/src/features/transaction/tabs/shared.tsx` at lines 2 and
  4.
- **Which check finds it, and which does not.** Two packages define a script
  called `check` and they are not the same script. From `frontend-new`, `check`
  is `format:check && lint && typecheck && test` and fails. From
  `frontend-new/app`, `check` is `typecheck && lint && test`, its `lint` is
  `eslint src e2e scripts`, and it **passes**, verified fresh at this commit with
  exit 0. The app's own ESLint configuration does not report the unused imports;
  only the workspace configuration invoked from `frontend-new` does. A developer
  who runs "the check" in the package they are editing therefore gets a green
  that the gate rejects.
- **Where it came from.** The lint error entered at `6bad6cdd`. The ten
  formatting failures entered across six commits, the earliest being `0bf26a8c`
  on 2026-09-16: `block-roots.spec.ts` (`0bf26a8c`), `BlockView.tsx`
  (`922f9845`), `address-utxo-paging.test.tsx` (`1dcf6ba9`),
  `address-paging.spec.ts` and `data.mjs` (`5d5710a5`), `health.test.ts`
  (`4640b7d9`), and `core-flows.spec.ts`, `developer-surface.spec.ts`,
  `iconography.spec.ts` and `populated.spec.ts` (`0aab19b9`).
- **Impact.** The `Frontend` job in `../.github/workflows/ci.yml` invokes the
  same script, so the gate stops at step three wherever it runs. The type check,
  the three unit suites, the production build and the browser suite are never
  reached in one pass. Nothing on this branch is pushed and no workflow records
  were consulted, so nothing here describes hosted run history. This is the same
  failure class the register already records as "six unused imports in the
  frontend", recurring.
- **Remedy.** Run Prettier's write mode over the workspace and delete the two
  imports. Effort: extra small, under ten minutes.
- **Verification.** `cd frontend-new && ./scripts/ci-local.sh --fast` exits 0,
  then the full script.
- **Dependencies.** None. Everything else in this register is easier to trust
  once this is green, so it goes first.
- **Remediation.** Corrected after this audit was written, in a separate commit:
  the ten affected files were formatted and the two imports removed. The
  remediation result is in the ledger, section 6.

#### B2. Two list routes scroll the page sideways at 1280 px

- **Area** Usability. **Severity** Medium to high. **Confidence** High.
  **Evidence** Reproduced.
- **What.** At 1280 x 800, the `Desktop Chrome` device profile the browser suite
  itself uses, `/deposits` pushes the document 106 px past the viewport and
  `/withdrawals` 195 px. Both themes. Stable when sampled at nine points over
  20 seconds, so it is not a hydration race.
- **Cause.** Every list route wraps its table in the same
  `div.overflow-x-auto` container. That container is not width bounded, so
  instead of scrolling internally it grows to the table's intrinsic width,
  1373 px for deposits and 1462 px for withdrawals, inside a 1230 px content
  column. `blocks`, `transactions` and `assets` escape only because their tables
  measure 1230 px and fit. The defect is latent on every table route.
- **Why the suite is green.** The assertion is correct and is not vacuous.
  `../frontend-new/app/e2e/populated.spec.ts` at line 165 asserts both the
  scroller and the page width, but calls `setViewportSize({ width: 1440 })`
  first, and at 1440 px the table fits.
  `../frontend-new/app/e2e/core-flows.spec.ts` at line 293 asserts the same
  property at 320 px. The suite's own default desktop width, 1280 px, is
  asserted nowhere for these routes.
- **Remedy.** Bound the scroll container so `overflow-x: auto` engages, by
  adding `min-w-0` to the flex or grid chain above it. Then extend the
  no-overflow assertion to 1280 px across the list routes.
- **Verification.** At 1280 px, `document.documentElement.scrollWidth` is not
  greater than `clientWidth` on `/deposits` and `/withdrawals`.
- **Dependencies.** B1. This is a visual change and needs visual review before
  the next step.

### 3.2 High

#### H1. The documented memory minimum is wrong for the transaction page

- **Area** Developer experience, performance. **Severity** High.
  **Confidence** High. **Evidence** Reproduced, with a kernel log.
- **What.** The kernel killed `next-server` at 17:23:45 on 2026-09-17 with
  `anon-rss:2277556kB`, that is 2.28 GB, while Turbopack compiled
  `/transaction/[txHash]` in development mode.
- **Why the documented figure missed it.** `resource-requirements.md` derives
  the development server's hard floor, between 768 MB and 896 MB, from a matrix
  whose only column is "`next dev` serves the overview". The observed peak of
  1671 MB comes from a sweep over "the overview, blocks, transactions, L1,
  deposits and assets pages". The transaction detail route is in neither. The
  `demo` minimum of 1 GB is rounded up from the first of those.
- **Impact.** A developer who provisions to the documented 1 GB minimum loses
  the development server the first time they open a transaction page, which is
  the most-visited page in a block explorer. The failure looks like a crash
  rather than a memory limit.
- **What is not affected.** `next build` peaked at 1.27 GB and succeeded in
  25.3 seconds, which sits inside the documented 1024 MB to 1536 MB band. The
  gap is specific to the development compile of that one route.
- **Remedy.** Add `/transaction/[txHash]`, including its flow and raw views, to
  both the enforced-ceiling matrix and the observed-peak sweep, then restate the
  per-mode minimum from what that produces.
- **Verification.** `measure.mjs limit 2048` and the lower ceilings, with the
  transaction route in the swept set.
- **Dependencies.** Needs a quiet window, about 30 minutes.

#### H2. The Web Vitals beacon is blocked by the application's own policy

- **Area** Security configuration, observability. **Severity** High for the
  telemetry criterion. **Confidence** High. **Evidence** Reproduced.
- **What.** `../frontend-new/app/src/lib/contentSecurityPolicy.ts` hard-codes
  `connect-src 'self'` at line 16.
  `../frontend-new/app/src/components/shell/WebVitals.tsx` posts to
  `${PUBLIC_API_BASE}/api/vitals` at line 22, an absolute URL. When the API base
  is a different origin from the application, the browser refuses the request:
  "Connecting to ... violates the following Content Security Policy directive:
  `connect-src 'self'`. The action has been blocked." Observed on 17 of the 19
  routes swept.
- **Blast radius, precisely.** Exactly one feature. The health indicator, the
  overview and the prefix search all fetch same-origin relative paths
  (`/api/health`, `/api/overview`, `/api/search`), which are Next route handlers
  on the application's own origin, and are unaffected. Nothing else in the
  browser calls the API base directly.
- **Why this matters beyond the feature.** The register records Web Vitals as
  `INSUFFICIENT: 0 samples against 1,000 per cell` and attributes it to no
  production deployment having reported a sample. This is a second mechanism
  that produces zero samples even after a deployment exists, in one of the two
  deployment shapes the README documents. Web Vitals are criterion 5 of the
  definition of done.
- **Why the browser suite is green.**
  `../frontend-new/app/e2e/security-headers.spec.ts` collects policy violations
  on `/` only, and `/` was one of the two routes in the sweep where no violation
  appeared. The beacon fires later in a page's life than that assertion looks.
- **Remedy.** Preferred: post the sample to a same-origin Next route handler
  that forwards to the backend, matching how health, overview and search already
  work. This needs no policy widening. Alternative: add the configured API
  origin to `connect-src`, which widens the policy for every request.
- **The browser suite does not cover this, and now covers the opposite shape.**
  Since M7 the suite builds with an empty public API base, which is what lets
  that build be strict. It therefore exercises the same-origin deployment shape,
  in which this finding does not occur, and no longer runs in the split-origin
  shape where it does. No coverage was lost, because the split-origin path was
  never asserted. A green suite is not evidence about this finding either way.
- **Verification.** Build with an API base on a different origin, load several
  routes, and assert no policy violation naming `/api/vitals`. Add a unit case
  asserting the policy admits the configured origin if the alternative is taken.

#### H3. The frontend workspace has no dependency advisory gate

- **Area** Security. **Severity** Medium to high. **Confidence** High.
  **Evidence** Source-confirmed, with a fresh run of the backend gate.
- **What.** `backend/scripts/audit-gate.mjs` and `backend/security-advisories.json`
  gate the backend, and the gate works: a fresh run reported three advisories,
  all with a recorded disposition, and exited 0. There is no equivalent for
  `frontend-new`. It has no advisories file, `ci-local.sh` has no audit step,
  and neither workflow runs one.
- **Impact.** `frontend-new` is the internet-facing half: Next 16, React 19, and
  the largest tracked surface in the repository. An advisory in it reaches
  production with nothing recorded about whether it was considered.
- **What is already working.** pnpm 11 checks the lockfile against its own
  supply-chain policies on every install, and reported a pass. That is a
  different control from an advisory gate with written dispositions, and does
  not replace it.
- **Remedy.** Point the existing `audit-gate.mjs` at `frontend-new` with its own
  advisories file and add one step to `ci-local.sh`. The script already refuses
  to pass when the audit could not be produced, so that property carries over.
- **Verification.** Introduce a known advisory with no disposition and confirm
  the gate fails; record the disposition and confirm it passes.

#### H4. Page offsets are unbounded on every offset-paginated route

- **Area** Security, availability, performance. **Severity** High.
  **Confidence** High. **Evidence** Source-confirmed, corroborated by the stress
  artifact.
- **What.** `../backend/src/server/validate.ts` accepts any integer of 1 or more
  and applies no maximum. `../backend/src/db/address.ts` and
  `../backend/src/db/transaction.ts` then compute an offset from it.
  `?page=999999999` on the address route produces `OFFSET 24999999975`. The work
  is bounded only by `DB_STATEMENT_TIMEOUT_MS`, which defaults to 10,000, and by
  a pool of 8 connections. An anonymous caller may send 120 such requests per
  minute per client identity.
- **Corroboration.** The `stress` artifact already measures the shape of this
  without an attacker: `blocks-list-saturation` served 9 requests of 1,000 at
  99.10% errors and 12.0 requests per second against a floor of 20, and
  `address-history` served 0 of 1,000.
- **Remedy.** Cap the depth in `parsePageParam` and answer 400 past it. The
  register already names this as the fallback for four failing rows, as "a depth
  cap with a documented error past it". It is the smaller half of the planned
  `CURSOR-PAGINATION` item and does not depend on the rest of it.
- **Verification.** A request past the cap answers 400 and issues no database
  statement. Rerun `blocks-list-saturation` and read the error rate.

### 3.3 Medium

#### M1. The benchmark harness's own tests never run in continuous integration

- **Severity** Medium. **Confidence** High. **Evidence** Reproduced.
- Five of 95 backend test files skipped in a run with `REQUIRE_DB=1` set. Their
  gates are `BENCH_POSTGRES_URL` for `bench-pg-stats` and `bench-environment`,
  `BENCH_SMOKE` with two URLs for `bench-smoke`, `BENCH_TARGET` for
  `bench-target-profile`, and an index URL for `bench-clone-index`. None of those
  variables appears in either workflow or in `backend/.env.example`.
- The harness produces every certified figure in the register, and is therefore
  the least verified component in the repository by its own gate.
- **Remedy.** Give the nightly workflow a benchmark Postgres service and set the
  variables, or record them in the register as a mandatory pre-baseline
  checklist so the omission is at least visible.

#### M2. `REQUIRE_DB=1` does not force the indexer tests to run

- **Severity** Medium. **Confidence** High. **Evidence** Source-confirmed.
- The README states that `REQUIRE_DB=1` makes the database-backed tests fail
  rather than skip. Six files guard their cases with
  `ctx.skip(!reachable, "indexer Postgres unreachable on 5435")`, which does not
  consult `REQUIRE_DB` at all: `indexer-db`, `indexer-ingest`,
  `indexer-leadership`, `indexer-sync`, `indexer-reconciliation` and
  `l1-routes`.
- With the index database down, those cases skip silently and the suite still
  reports success with the variable set. Continuous integration provisions the
  service, so this bites the local gate rather than the hosted one, which is
  where a developer decides whether to propose a commit.
- **Remedy.** Make the reachability guard fail rather than skip when
  `REQUIRE_DB` is `1`.

#### M3. Five browser tests skip on fixture content instead of asserting it

- **Severity** Medium. **Confidence** High. **Evidence** Source-confirmed.
- The browser suite carries 13 conditional skips. Eight are viewport or
  complementary-project guards and are correct. Five depend on fixture content:
  `layout.spec.ts` line 98, and `populated.spec.ts` lines 435, 459, 614 and 677.
- The reported verification described the skips as complementary-project and
  viewport guards. Five of the thirteen are not, which matters because the
  fixture is committed and under our control: an edit that drops the named asset
  or the undecodable row removes the coverage and leaves the suite green.
- **Remedy.** Assert the precondition and fail when it is absent, since a
  missing fixture row is a fixture defect rather than an environment.

#### M4. Transaction status is derived in three places, one with a dead branch

- **Severity** Medium. **Confidence** High for the dead branch, medium for the
  drift risk. **Evidence** Source-confirmed.
- Three derivations: `../backend/src/server/routes/address.ts` produces four
  outcomes including `unknown`, keyed on the header hash and the source tier;
  `../backend/src/server/routes/transaction.ts` produces three, keyed on the
  source; and the same file's list handler produces two, keyed on a `committed`
  column.
- That column is written as the literal `true AS committed` in
  `../backend/src/db/transaction.ts`, because the list query reads only the
  finalization journal. The `pending_commit` branch is therefore unreachable and
  the column name suggests a variability the query does not have.
- **Stated at the strength of the evidence.** No contradictory label for one
  transaction was demonstrated. The address route's extra header-hash condition
  covers a case the detail route cannot reach, so the three are complementary
  rather than shown to disagree. The finding is a dead branch plus a real drift
  risk, not a proven wrong label.
- **Remedy.** One exported status function used by all three, and drop the
  constant column.

#### M5. The address balance decodes every UTxO at the address, unbounded

- **Severity** Medium. **Confidence** High for the mechanism, low for it being
  the dominant memory contributor. **Evidence** Source-confirmed.
- `../backend/src/server/routes/address.ts` computes the balance over the whole
  result of `getAddressUtxos`, which correctly carries no limit, because a total
  from one page would be wrong and wrong quietly. The response is bounded to
  102 KB since `2e3b2f09`. The database fetch and the CBOR decode are not.
- `getSpendableLedger` has a scan limit of 20,000 and a `truncated` flag. The
  address balance path has neither.
- This is the register's own warning made concrete: bounding the returned UTxOs
  does not bound the database fetching or the balance work.
- **This is a measurement task before it is an implementation task.** It is a
  candidate for the unexplained 737.3 MB backend peak, alongside `asset-roster`
  cold, which the handoff already names as decoding 20,000 UTxOs per request. Do
  not act on it until an isolated measurement says which one dominates.

#### M6. Two scripts named `check` do different things, and the inner one is weaker

- **Severity** Medium. **Confidence** High. **Evidence** Reproduced.
- From `frontend-new`, `pnpm check` is
  `format:check && lint && typecheck && test`, and its `lint` runs the workspace
  ESLint configuration across the whole tree. From `frontend-new/app`,
  `pnpm check` is `typecheck && lint && test`, with no format step, and its
  `lint` is `eslint src e2e scripts` under the app's own configuration.
- At this commit the outer one fails and the inner one passes, exit 0, on the
  same code. The app configuration does not report the unused imports that the
  workspace configuration does.
- **Impact.** A developer working inside `app`, which is where almost all the
  code is, runs the check in the package they are editing, sees green, and
  proposes a commit the gate rejects. This is how B1 reached eleven commits
  without anyone seeing a failure. Fixing B1 does not fix this: the next
  formatting drift will be invisible from `app` in exactly the same way.
- **Remedy.** Make the inner script defer to the gate rather than approximate
  it, or rename it so the two cannot be confused. The repository already has a
  decision that there should be one way to start the explorer rather than two
  that must agree, and the same reasoning applies to checking it.
- **Verification.** Reintroduce an unused import and confirm both `check`
  scripts fail.

#### M7. The gate builds the application twice

- **Severity** Medium. **Confidence** High. **Evidence** Reproduced, and
  confirmed in both scripts.
- `frontend-new/scripts/ci-local.sh` runs `next build` as its production build
  step. The browser stage then runs Playwright, and
  `../frontend-new/app/playwright.config.ts` declares its web server as
  `pnpm build && pnpm start`, which builds from scratch again.
- **Impact.** The gate pays for two full builds in wall time, and its peak
  memory demand is set by a build that has already been done. On this machine
  the second build is where the full gate stops. On a hosted runner it is
  wasted minutes against a continuous integration median that already fails its
  own 8 minute target at 10.68 minutes.
- **Preserve strict configuration validation.** The old standalone build used
  `MG_STRICT_CONFIG=1`; the original browser build used a public loopback API
  URL that strict mode rejects. However, the existing guard also supports an
  empty public API base for same-origin requests. A loopback *server-side* API
  URL is allowed. The earlier assertion that the fixture build could not be
  strict was incorrect.
- **Remedy applied.** Playwright now owns the full gate's only production build
  with `MG_STRICT_CONFIG=1`, an empty public API base, a public-shaped site URL,
  and the fixture's loopback server-side URL. The actual build evaluates the
  existing root-layout assertion. The `--fast` path retains its standalone
  strict build. Server reuse remains disabled by default.
- **Superseded approach.** The proposed `strict-config-check.mjs` source-pattern
  check was removed before commit. Its historical checks below do not validate
  the final implementation; indentation is not a reliable test of JavaScript
  execution scope.
- **Verification.** Added strict-mode tests for the supported same-origin
  configuration and rejection of missing or visitor-local public API URLs.
  Final gate results are recorded in section 6.

### 3.4 Low

| ID | Finding | Evidence | Remedy |
|---|---|---|---|
| L1 | The skip link does not move focus. `<main id="main">` carries no `tabindex`, so after activating it `document.activeElement` is `body`. Chromium's sequential focus starting point still sends the next Tab into `main`, so Tab users are served; assistive technology and other engines are less certain | Reproduced | `tabIndex={-1}` on `main`. Assert `document.activeElement.id` is `main` after activation |
| L2 | Information triggers measure 16 x 16 px, below the 24 x 24 px minimum in WCAG 2.2 success criterion 2.5.8. Up to 84 sub-24 px interactive elements were counted on one page at 375 px. axe ran with 2.0 and 2.1 tags, which do not include 2.5.8, so zero violations is consistent with this | Reproduced | Pad the trigger to 24 x 24 without changing the glyph |
| L3 | The node migration hazard is real and undocumented here. The live node database records **12** rows in `schema_migrations` while the node checkout declares **one** SQL migration. The node's runner tracks checksum mismatches and has a `verification_failed` state, so a rebuild against the existing volume is expected to fail verification. This repository documents how to run the node and has a page for exactly this class of problem | Reproduced (counted both sides; the rebuild was not attempted) | A short section in `upstream-node-defects.md` |
| L4 | `../frontend-new/app/e2e/utxo-flow.spec.ts` gives a 503-node layout a fixed 15 second budget, which is a wall-clock assertion on CPU-bound work. That this is what caused the single reported timeout is a **hypothesis and is not established**: no run reproduced it under observation, and scheduling pressure was never measured during the failing run. The wall-clock budget is a real property of the test either way | Source-confirmed for the budget. Hypothesis for the cause | Raise the budget for the complementary projects, or assert on a worker completion signal rather than elapsed time. Settling the cause needs the timeout reproduced with load recorded |
| L5 | The documentation gate resolves links against the working tree rather than against tracked files, so a tracked page linking into a git-excluded path would pass locally and be dead in a fresh clone. No tracked page currently does this, so the weakness is latent | Source-confirmed | Resolve link targets against `git ls-files` |
| L7 | A React hydration warning was seen once, on the block page at 390 px against the **development** server, while the machine had about 480 MB of memory available: "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties." **Unresolved.** It did not reproduce in 40 loads of a production build across five theme configurations (system preference only, and a stored choice agreeing and disagreeing with it) on four pages. No cause is established, and it is not attributed to the harness that observed it | Observed once; not reproduced | Reproduce before changing anything. Capturing the differing attribute needs the warning to occur, so the next step is a loaded development server rather than a fix |
| L6 | Housekeeping. A worktree at `922f9845` is registered and clean, with nothing to preserve, and one entry is prunable. Two benchmark containers have been running for 20 hours and two days on a machine that kills processes for memory. Reported only; nothing was stopped or removed | Reproduced | Owner's call |

### 3.5 The gap in the definition of done

#### G1. The stated definition of "10/10" measures no security, correctness or accessibility dimension

- **Severity** High, because this is what makes any readiness claim defensible.
  **Confidence** High. **Evidence** Source-confirmed.
- Criterion 9 of the plan names eleven dimensions for the final audit: latency
  and throughput; database and pagination; caching and amplification;
  compression and payload; browser bundle, memory and Web Vitals; test speed and
  stability; continuous integration time and reliability; dead weight
  retirement; duplication and change complexity; persisted-data freshness and
  parity; and fixture validity. Criterion 0 adds shadow parity, which is the
  nearest thing to a correctness criterion.
- None of them is security, data-integrity invariants, or accessibility.
- **Consequence.** B1, B2, H2 and H3 could all be outstanding while every stated
  condition for "10/10" is met, because no row measures them. That is the same
  failure mode the register already names for undecided artifacts: a dimension
  with no row reads as a pass because nobody wrote down that it fails.
- **Remedy.** Add three rows to the register. An advisory gate covering both
  workspaces, pass or fail. An accessibility budget, which can be set as a
  ratchet at today's measured zero violations across 19 routes in both themes
  and both viewports, plus a target-size criterion. And a correctness-invariant
  budget naming the invariants in section 4 of this page.

### 3.6 Reconciling the performance evidence

Every performance figure quoted in this page is **historical**. This section says
how old each one is, what supersedes it, and what could not be found.

**The artifacts that exist.** Four benchmark reports are on disk. Three carry the
`target` profile and one carries `stress`.

| Artifact | Commit | Written | Peak resident memory |
|---|---|---|---|
| `../backend/bench-baseline-target.json` | not stamped | 2026-09-04 16:54 | field absent |
| [`target-7b1731d5.json`](performance/baselines/target-7b1731d5.json) | `7b1731d5` | 2026-09-04 19:39 | field absent |
| [`target-efc9af69.json`](performance/baselines/target-efc9af69.json) | `efc9af69` | 2026-09-05 06:25 | 773,140,480 bytes, that is 737.3 MB |
| [`stress-5ded259a.json`](performance/baselines/stress-5ded259a.json) | `5ded259a` | 2026-09-16 16:07 | recorded at 517.2 MB in the register |

`target-efc9af69.json` is the newest `target` report, it is the one
`performance-budgets.md` cites, and its figures are the ones quoted in the
scorecard. The first two are older and neither records peak memory at all.

**The later results, and why they are not here.** Two figures have been reported
since, and neither is preserved as an artifact.

- **682.6 MB peak resident memory**, reported as a suite peak against the same
  512 MB target.
- **Passing target workloads**, reported after the fixes that followed
  `efc9af69`. The two failures in that artifact are `block-detail` on route
  statements and `transactions-list-page-deep` on temporary I/O, and the register
  records that `0bcc98d5` and `a66273e6` target exactly those two.

Both are **reported results whose artifacts are unavailable**. That is their
status here, and it is not a downgrade. This audit searched
`performance/baselines/`, the repository, and the benchmark reports left in
earlier session directories, and found no file carrying either figure. It did
**not** find evidence that they were produced by a different measurement method
from `efc9af69`, so nothing here reclassifies them, contradicts them, or replaces
737.3 MB with them. They are treated as unverified for the narrow reason that the
file which would verify them could not be located.

The register's own words for the workload rows are that they "keep this run's
figures until a rerun records them", which is the same position: a later
measurement exists and the recorded baseline has not moved.

**What this means for the verdict.** The performance area is marked **measured
fail on historical evidence** rather than measured fail. The failures are real in
the artifacts that exist, later reported results indicate at least three of them
have moved, and no artifact available to this audit settles which description is
current. This strengthens the case for the canonical target
rerun in section 5 rather than weakening it: that rerun is the only thing that
converts this area from historical to current.

**The stress figures are the stalest.** `stress-5ded259a.json` was built from a
commit that predates `0bcc98d5`, `a66273e6` and the address filter pushdown in
`2e3b2f09`. Its worst row, `address-history` failing every request while writing
6.2 GB of temporary files per request, is the exact query `2e3b2f09` repaired.
Nobody knows what that row reads today.

### 3.7 Reconciliation after the Cardano index decommission, 2026-09-18

The explorer-owned Cardano index was decommissioned the day after this audit, in
commits `375c0813`, `baa3baca`, `9fa47f23` and `02d75136`. Some findings above
describe code that no longer exists. This section says which, so that no work is
spent on a deleted surface. Every other finding stands as written.

| Finding | Status | Reason |
|---|---|---|
| B1 | Closed | Remediated before the decommission. Recorded in section 6 |
| M7 | Closed | Remediated. One build, owned by Playwright |
| M2 | **Closed, obsolete** | The six files it named are deleted. `grep -rn 'ctx.skip(!' backend/test/` returns nothing, so the guard pattern it described is gone from the suite |
| M1 | **Reduced** | Four of the five skipped benchmark self-tests stand. The fifth, `bench-clone-index`, now tests deleted infrastructure and is itself a cleanup item, not a coverage gap |
| H4 | **Surface changed** | Six routes still parse a page through `parsePageParam`. `/api/l1/activity/:page` is a seventh offset path and is not one of them: it coerces a bad page to the first, so a cap there has to clamp rather than answer 400 |
| B2 | **Needs re-measurement** | `/deposits` lost its Cardano source column in `9fa47f23`, so the 1373 px intrinsic width that produced the 106 px overflow is no longer the measured width. `/withdrawals` is untouched. Measure both again before fixing either |
| M3 | Stands | Still five fixture-content skips. The line numbers moved: `layout.spec.ts:98` and `populated.spec.ts:422`, `446`, `603`, `666` |
| M4 | Stands | The `tx_source` tiers it names are Midgard's, not the index's. Unaffected |
| L6 | Partly actioned | The explorer database was stopped on 2026-09-18 with its container and `midgard-explorer_explorer-pgdata` volume preserved. The benchmark containers are unchanged |

**Two consequences the decommission did not carry through, found here.**

1. `backend/scripts/lib/net.mjs` kept a `sync-state` subcommand that read
   `/api/l1/summary`, a route that no longer exists, and `lifecycle.mjs` still
   offered `dev [--with-l1-sync]` in its usage text after the flag was removed.
   Nothing invoked either. Both are removed as of this section; `pnpm test:dev`
   passes 47 of 47.
2. **The benchmark harness cannot run.** `bench/cli.mts` and `bench/attribute.mts`
   refuse to start without `BENCH_SOURCE_INDEX_URL`, and `setupBench` clones the
   index's tables to get the real header hashes that settle its generated
   blocks. Those hashes now live in the node's own
   `pending_block_finalizations`. Until the harness reads them from there, all
   three `pnpm bench` rows in section 5 are blocked. `bench/measure.mts` imports
   nothing from the index, so H1's memory measurement is not blocked by this,
   though it has not been run since.

**What this section does not do.** It does not restate the scorecard in section
2. Those figures are dated evidence from 2026-09-17 and remain true of that
date. Three of them are no longer true of the head: the backend and app test
counts (813 and 497, now 543 and 473), the security surface "every file in `db/`
and `indexer/`" (`indexer/` is deleted, and `db/cardanoActivity.ts` post-dates
the review), and the untested-scope note about indexer ingest paths. A delta
review of the four new `db/` and route files is the smallest thing that would
restore that row's evidence.

### 3.8 Closure record, 2026-09-18

What was done about each finding, and the evidence. A finding is closed here
only by a verified fix or by evidence that the capability it describes was
removed. "Passing tests" is not on its own either of those.

| Finding | State | Evidence |
|---|---|---|
| B1 gate red | **Closed** | Remediated before this batch; recorded in section 6 |
| B2 sideways scroll | **Closed** | Re-measured first: `/deposits` 106 px, `/withdrawals` 195 px and `/forced-transactions` 46 px at 1280, a route the finding did not name. Cause was not the table's width: the scroll container clipped it correctly and an absolutely positioned descendant, with no positioned ancestor inside the scroller, extended the DOCUMENT's scroll area. `position: relative` on the shared container. 0 px on seven routes at 1280, 1024, 390 and 1600 in both themes, and the table still scrolls internally (143 px and 232 px of content) |
| H1 memory minimum | **Closed** | The ceiling run now serves the transaction route, not just the overview. At 1024 MB it serves `/` and `/blocks` then dies compiling `/transaction/[txHash]`; 1536 MB and 2048 MB succeed in 11s. Observed peak with that route swept: 1622 MB. `demo` minimum restated from 1 GB to 2 GB |
| H2 Web Vitals blocked | **Closed** | Verified in the split-origin shape itself, built with a visitor-reachable API origin. The old absolute destination is refused with the exact violation the finding names; the new same-origin route handler delivers with `connect-src 'self'` unchanged |
| H3 no frontend advisory gate | **Closed** | One gate, two workspaces. It found three production advisories on the day it was added: two critical Next remote-code-execution and one high in sharp. All three fixed by upgrading, not accepted, so the dispositions file is empty. Gate proven in both directions: exit 1 with the advisory present, exit 0 with it gone |
| H4 unbounded page depth | **Closed** | Seven offset paths bounded at 100,000 rows scanned, refused before any statement. Proven with the database layer mocked: an over-limit request never reaches it and an in-bound one does. Live: 400 on every route past its bound, including the Cardano activity route, which keeps coercing a malformed page and now refuses an excessive one |
| M1 benchmark self-tests | **Partly closed** | Three of the four run nightly against a Postgres started with `pg_stat_statements` preloaded, which a service container cannot do. Verified locally: 8 and 5 tests, previously 0. `bench-smoke` stays out, and why is written into the job |
| M2 indexer skips | **Closed, obsolete** | The files are deleted; the guard pattern is gone from the suite |
| M3 fixture-conditional skips | **Closed** | All five assert their precondition. `populated.spec.ts` now carries zero `test.skip` |
| M4 three status derivations | **Closed** | One exported function, three callers, and the constant `true AS committed` column dropped from the query and from the test's reference query. An unrecognised tier reads as `unknown` |
| M5 unbounded balance decode | **Open, unchanged** | A measurement task before an implementation task, and the measurement it needs is the isolated address-history profile |
| M6 two `check` scripts | **Closed** | `pnpm check` inside `app` now runs the gate. Reproduced the divergence first: on one unused import `check:app` exits 0 and the gate exits 1. `check:app` remains as the faster subset, named so it cannot be mistaken for the gate |
| M7 double build | **Closed** | Remediated earlier |
| L1 skip link focus | **Closed** | `tabIndex={-1}` on `main`; asserted, and the assertion fails without it |
| L2 target size | **Closed, not a defect as stated** | Measured rather than read: the trigger paints 16 px and accepts a pointer over **43 x 43 px** through its pseudo-element, above the 24 px minimum. The finding measured the painted box. Both numbers are now asserted |
| L3 node rebuild hazard | **Closed** | Written up in `upstream-node-defects.md` with both counts re-verified: 12 recorded migrations against one declared file |
| L4 wall-clock budget | **Closed** | The elapsed-time assertion is removed. Every step it followed already waits on the canvas's own completion signals, so it restated them in a form that measures the machine |
| L5 docs links | **Closed** | Resolved against `git ls-files`. Proven with a real git-excluded page: the gate names it |
| L6 housekeeping | **Partly actioned** | The explorer database is stopped with its volume kept. Benchmark containers are started and removed per run |
| L7 hydration warning | **Open, not reproduced** | 24 further loads against a development server at 390 px, across both OS colour schemes and three stored-theme states, on four routes including the block page, with the stored theme confirmed applied. Zero warnings, on top of the 40 production loads already recorded. The original sighting was under memory pressure, about 480 MB available; that condition was not recreated, so absence here is not evidence it is fixed |
| G1 definition of done | **Closed** | Section 7 now carries the three missing rows |

## 4. Invariants checked

These are the observable properties an explorer has to hold. They are recorded
here so they can become a budget row rather than an audit that happened once.

| Invariant | Verdict | Evidence |
|---|---|---|
| No monetary amount is ever a JavaScript `number` | **Pass** | `bigint` throughout the backend, a branded unsigned decimal string on the wire, `BigInt()` in `formatAda`. Every `Number()` call in the backend was inspected: all are counts, ports, page numbers or timestamps |
| A mint quantity can be negative and survives the contract | **Pass** | A separate signed decimal string exists because the unsigned one made a burn unrepresentable and rejected the whole response |
| An address balance covers every UTxO, not the returned page | **Pass** | The UTxO query carries no limit by design, and the route documents why |
| A returned page of UTxOs is bounded | **Pass** | 50 per page, keyset ordered on the output reference |
| A UTxO cursor is validated before use | **Pass** | An even-length hex pattern at the route, answering 400 |
| A page of history and the total beside it describe one ledger | **Pass** | Both read inside one repeatable-read snapshot, and the balance shares it |
| A page number cannot be unbounded | **Fail** | H4 |
| Traversal cannot skip or duplicate rows as the ledger changes | **Partial** | The UTxO page is keyset, exactly so. Address history still uses `OFFSET`, which has the property the UTxO comment describes as the reason not to use it |
| A decode failure degrades one row rather than the response | **Pass** | Per-row `decodeError`, and an `undecodedOutputs` flag on the balance |
| The interface distinguishes "not known" from "none" | **Pass** | A count of zero renders as an explicit absence with the word "none" for a screen reader, not a silent blank |
| No script-injection path found in the rendered surfaces | **Pass** | One `dangerouslySetInnerHTML`, for a static nonce-bearing theme script. Nonce policy with `strict-dynamic`, proved by a negative test |
| No external link reaches a non-HTTP scheme | **Pass** | The explorer URL template is validated to `http:` or `https:`, and every external link carries `rel="noopener noreferrer"` |
| An error response leaks nothing about the database | **Pass** | Generic JSON; the driver message goes to the log |

## 5. Execution plan

Measurement tasks and implementation tasks are separated, because acting before
measuring is what produced the rejected heap cap.

### The next three tasks, in order

Rewritten 2026-09-18. B1, B2, H1, H2, H3, H4, M1, M2, M3, M4, M6, M7, L1, L2,
L3, L4, L5 and G1 are closed; section 3.8 records the evidence for each. What
is left is one measurement, one mechanism, and one thing that has not
reproduced.

1. **Identify what dominates backend peak resident memory (M5).** The target
   profile at this head peaks at 669.4 MB against a 512 MB budget, recorded in
   `docs/performance/baselines/target-44ad31ad.json`. That is below both
   earlier figures, 737.3 MB measured and 682.6 MB reported, and still a
   breach. The budget itself has no recorded derivation, which
   `performance-budgets.md` now says. The next step is the isolated `address-history` profile, and
   the task is finished when the mechanism is named rather than when the number
   moves.
2. **Run the stress profile.** It needs 30 GB of free disk and this machine has
   27.8 GB, which the harness warns about and which would make the figures
   describe a starved filesystem. Nothing else blocks it.
3. **Reproduce the hydration warning (L7), or leave it open.** 64 loads across
   development and production builds have not. The one condition not recreated
   is the memory pressure of the original sighting.

### Fits in one hour

- H3, the frontend advisory gate.
- M3, turn the five fixture-conditional skips into assertions.
- L3, document the node migration hazard.
- G1, add the three missing register rows.

### Fits in one day

- B2, the overflow fix, with visual review.
- H4, the depth cap.
- H2, move the Web Vitals beacon to a same-origin route handler.
- M4, one status function.
- L1 and L2, the skip link target and the trigger size.
- L4, the flow layout budget.

### Needs a coordinated resource window

Each of these needs the development servers stopped. Ask for the window; do not
start one while they are up, because the memory guard aborts and the latency
figures would be skewed anyway.

**The harness runs again.** It refused to start without the decommissioned
index until 2026-09-18; it now reads its real settled header hashes from the
node's finalization journal, so `BENCH_SOURCE_NODE_URL` replaces
`BENCH_SOURCE_INDEX_URL` and no second database is cloned.

| Task | Command | Resource need | Expected duration | State |
|---|---|---|---|---|
| **Measure** the development memory peak for the transaction route (H1) | `measure.mjs limit 1024`, then 1536 and 2048, with the transaction route in the swept set | 2 cores, 3 GB free | 30 minutes | **Done 2026-09-18.** 1024 MB fails on that route, 1536 MB and 2048 MB pass, observed peak 1622 MB |
| **Measure** the canonical target rerun at the current head | `pnpm bench --profile target --mode baseline --iterations 1000 --with-frontend` | quiet machine, 4 GB available | 60 minutes | **Done 2026-09-18.** 13 of 13 workloads pass; peak resident memory 669.4 MB against a 512 MB budget |
| **Measure** the isolated address-balance peak (M5) | `pnpm bench --only address-history --mode baseline --iterations 1000` at `target`, reading `peakRssBytes` | quiet machine, 3.5 GB available | 40 minutes | Open. It is the next step for the memory breach above |
| **Measure** the stress retry after the address fixes | `pnpm bench --profile stress --mode baseline --iterations 1000` | quiet machine, 3.5 GB available, 30 GB disk | 70 minutes, 10 of them seeding | Blocked on disk: 27.8 GB free against the 30 GB the harness requires, and it says so rather than running starved |

Both runs above were taken with the Cardano node, Ogmios, Kupo and the Midgard
node paused for the window, and with the Midgard database left running because
it is what the explorer reads. Every service was restarted and checked
afterwards.

The stress retry is the most valuable of the four. The current stress artifact
was built from `5ded259a`, which predates `2e3b2f09`, and its worst row is
`address-history` answering an error for every request while writing 6.2 GB of
temporary files. That is the exact query the address filter pushdown fixed. The
row may already be a different number, and nobody knows which.

### What not to work on yet, and why

| Do not | Because |
|---|---|
| Re-propose a 320 MB heap cap | Four certified runs rejected it: memory improved, latency and throughput got worse |
| Change anything for backend memory before M5's isolated measurement | The mechanism is not identified. Response size does not imply retained heap, and the register says so |
| Pull another upstream node branch | The branch in use is level with its upstream. The others cost a node database reset and change none of the seven tables the explorer reads |
| Rebuild the node from the current checkout | 12 recorded migrations against one declared. See L3 |
| Rewrite the recent commit history | The practical consequence is narrow: a bisect landing between `0bf26a8c` and the fix would find a red gate. That is not worth a rewrite of eleven reviewed commits |
| Start the remaining coverage work, the 65 adopted columns | It cannot be validated while the gate is red. After B1 |
| Touch the previous Vite client | Decided: keep, frozen. Adding it to a gate would be new work for a retired artifact |
| Convert the const-over-function sites | Decided previously, and no user-visible or maintenance benefit was established |
| Rewrite the status derivations before M4's shared function exists | Three call sites changed separately is how they diverged |

## 6. Verification ledger

### Fresh runs in this session, 2026-09-17

Every row below was run on this machine during the audit. The machine has two
cores, 11.9 GB of memory and 2 GB of swap, and carried other load throughout, so
every wall time here is an upper bound and none of them is a measurement of the
code.

**The working directory is part of the result.** Two packages define a script
called `check` and they run different things, so a result without its directory
cannot be read. Every row names where it ran.

| Check | Run in | Command | Result | Notes |
|---|---|---|---|---|
| Coverage lint | `backend` | `pnpm coverage:lint` | **Pass**, exit 0 | 18 assertions, including the prose counts |
| Documentation gate | `backend` | `pnpm docs:check` | **Pass**, exit 0 | 36 pages once this report existed |
| Type check | `backend` | `pnpm typecheck` | **Pass**, exit 0 | 23.0 s |
| Tests | `backend` | `REQUIRE_DB=1 pnpm vitest run` | **Pass**, exit 0 | 813 passed, 21 skipped, 90 files passed, 5 skipped. 274.8 s under load. See M1 for the five files |
| Development command tests | `backend` | `pnpm test:dev` | **Pass**, exit 0 | 51 tests, 13 suites, 0 skipped |
| Advisory gate | `backend` | `pnpm run audit:gate` | **Pass**, exit 0 | 3 advisories, all with a recorded disposition |
| Type check | `frontend-new` | `pnpm typecheck` | **Pass**, exit 0 | All three packages, 11.3 s |
| Format check | `frontend-new` | `pnpm format:check` | **FAIL**, exit 1 | 10 files. See B1 |
| Lint, workspace configuration | `frontend-new` | `pnpm lint` | **FAIL**, exit 1 | 2 errors. See B1 |
| Lint, app configuration | `frontend-new/app` | `pnpm lint` | **Pass**, exit 0 | The same two imports, not reported. This is the mismatch B1 records |
| Package check | `frontend-new/app` | `pnpm check` | **Pass**, exit 0 | `typecheck && lint && test`. No format step, and the narrower lint configuration |
| Unit tests | `frontend-new/app` | `pnpm vitest run` | **Pass**, exit 0 | 497 passed, 44 files. 53.7 s under load |
| Unit tests | `frontend-new/contracts`, `frontend-new/ui` | `pnpm test` | **Pass** | 12 and 3 tests |
| Production build | `frontend-new/app` | `next build` with the browser suite's environment | **Pass**, exit 0 | 25.3 s, 1.27 GB peak |
| Production build, strict | `frontend-new/app` | the same with strict configuration and a loopback API base | **Refused, correctly** | The guard rejected an API base a visitor cannot reach. This was the audit's own misconfiguration, and is recorded because it demonstrates the guard works |
| Browser sweep | `frontend-new/app` | 19 routes x 2 themes x 2 viewports against the production build | **0 axe violations in 76 page loads** | Also 0 unnamed controls, one `h1`, one `main` and a skip link everywhere. Two routes overflow: see B2 |
| Keyboard walk | `frontend-new/app` | 14 stops on the transaction page | **Pass** | A visible 2 px outline on every stop. Correct `tablist`, `aria-selected` and `aria-controls`. Information panels open on Enter and dismiss on Escape |
| Populated browser spec | `frontend-new/app` | `playwright test e2e/populated.spec.ts --project=desktop` | **Pass**, exit 0 | 68 passed in 1.3 minutes, against the running build. Green while B2 is real, for the reason B2 records |
| Demo mode | `frontend-new` | `pnpm dev:demo` | **Pass** | Ready in 521 ms, no backend, no Docker, no database, no secrets, exactly as the README claims |
| Development server, transaction route | `frontend-new/app` | first navigation to `/transaction/[txHash]` under `next dev` | **Killed by the kernel** | 2.28 GB resident. See H1 |
| Node migration state | the node's database and checkout | counted both sides | **Hazard confirmed** | 12 rows recorded against 1 declared migration. See L3 |

**After the B1 remediation**, which happened after this page was first written:

| Check | Run in | Command | Result |
|---|---|---|---|
| The gate, without the browser suite | `frontend-new` | `./scripts/ci-local.sh --fast` | **Pass**, exit 0, 108.5 s, 1.12 GB peak. Ten of the eleven steps |
| The gate, in full, before M7 | `frontend-new` | `./scripts/ci-local.sh` | **Did not complete**, exit 1 at 290 s. Ten steps passed. The browser stage never started: its web server ran a second `next build` and the kernel killed it, exit 137 |

**Initial M7 attempt (superseded)**, which made the full gate build once using
a source-pattern check instead of strict configuration in the browser build:

| Check | Run in | Command | Result |
|---|---|---|---|
| The wiring check, baseline | `frontend-new/app` | `node scripts/strict-config-check.mjs` | **Pass**, exit 0 |
| The wiring check, mutation A | `frontend-new/app` | the same, with the call deleted from the root layout | **Fails**, exit 1, naming the missing call |
| The wiring check, mutation B | `frontend-new/app` | the same, with the call indented so it would run per render | **Fails**, exit 1, naming the same property |
| The gate, without the browser suite | `frontend-new` | `./scripts/ci-local.sh --fast` | **Pass**, exit 0, 85.6 s, 1.12 GB peak. The strict build stays on this path |
| The gate, in full | `frontend-new` | `./scripts/ci-local.sh` | **Did not complete**, exit 1 at 1,360.6 s. It built once and the browser stage started, which it had not before. Desktop 249 passed and 3 failed. The kernel then killed the application server and the mobile project failed wholesale |

**What the full run after M7 actually established.** M7 did what it was meant to
do and did not make the gate pass.

- **The browser stage started.** Before M7 the run died at a second `next build`
  before any test ran. After M7 the desktop project ran to completion. That is
  the change M7 was for.
- **The application server was killed mid-run.** Kernel log, 18:39:56:
  `Out of memory: Killed process 84046 (next-server)`, `anon-rss:486248kB`,
  `oom_score_adj:1000`. The adjustment is this audit's own, set so the kernel
  takes our job rather than the Cardano node, which held 5.4 GB.
- **The mobile project then failed wholesale.** 223 failures, of which 221 are
  `net::ERR_CONNECTION_REFUSED` on the application port. Those are the harness
  losing its server, not tests finding defects. **The mobile half of the browser
  suite is unverified by this run**, not passed and not failed.
- **Three desktop tests failed before the kill, and their causes are
  undetermined.** They ran at 18:30, 18:37 and 18:38, ahead of the 18:39:56
  kill, so connection loss does not explain them. The machine was in heavy
  memory pressure with swap near capacity throughout, which is a condition these
  three assertions are each sensitive to, but that is a hypothesis and none of
  them was re-run quiet.

| Failing desktop test | Assertion | Measured |
|---|---|---|
| `help-affordances.spec.ts:61`, the portalled tip stays inside the viewport | `getByRole('tooltip')` visible within 5,000 ms | element not found |
| `type-scale.spec.ts:39`, no rendered text sits below 12px | `page.waitForFunction` inside a 90,000 ms test timeout | timeout exceeded |
| `utxo-flow.spec.ts:340`, positions all 503 stress nodes deterministically | layout completes in under 15,000 ms | **16,160 ms**, over by 7.7% |

The third is the same fixed 15 second budget on the same 503-node layout that
L4 describes, one test away from the line that produced the earlier reported
timeout. A measured overshoot of 7.7% on a memory-starved two-core machine is
**support for L4's hypothesis and not proof of it**: it is equally consistent
with a budget that is too tight for this hardware and with one that is correct
on hardware the gate should be run on.

**Acceptance check identified after that failed attempt** (completed below):
one full run on a machine with the headroom to hold a production build, two
browser projects and the fixture server at once, with those three desktop specs
re-run in isolation first to separate a defect from the machine.

The wiring-check mutation results above belong only to the superseded
approach. The final implementation uses the real strict production build.

**The earlier, pre-M7 full gate failed before browser tests started.** That
run cannot establish whether the browser suite would have passed.
Two things caused it, and only one of them is the machine:

- This box had about 1.8 GB available with the Cardano node resident at 4.3 GB,
  and the run carried an out-of-memory adjustment that deliberately makes it the
  kernel's first choice. A runner with more memory would not necessarily hit it.
- **The gate builds the application twice.** Step ten runs `next build`. The
  browser stage then starts Playwright, whose web server configuration is
  `pnpm build && pnpm start`, so it builds again from scratch. The second build
  is what was killed. See M7.

### Final M7 verification — 2026-09-17

Tested on `36d37d47` plus the uncommitted gate/configuration/test changes.
The user authorized pausing only Cardano node, Ogmios and Kupo; Midgard and
all databases remained running. An approval-service usage-limit interruption
briefly blocked execution and restoration; services were restored when tool
access returned, then paused again for the resumed full run. After the gate,
all three L1 services were restarted; Docker health checks confirmed Cardano
node, Ogmios, Kupo and Midgard node all running and healthy.

| Check | Result |
|---|---|
| Isolated desktop help-affordances, type-scale and utxo-flow specs, fresh strict build | Exit 0; 32 passed, one viewport skip, 1.2 minutes |
| Full `frontend-new/scripts/ci-local.sh` | **Exit 0, Gate green**; formatting, both lint configurations, all typechecks, unit suites, strict production build and both browser projects completed |
| Unit suites within that gate | Contracts 12; UI 3; app 501 across 44 files; all passed |
| Browser suite within that gate | **475 passed, 19 skipped, zero failures**, 7.7 minutes including its build/startup |
| Production build ownership | One build, owned by Playwright, with `MG_STRICT_CONFIG=1`; no server-reuse opt-in |

The three earlier desktop failures did not reproduce in isolation or the full
run. Their assertions and time budgets were unchanged. The full run passed the
503-node stress-layout test on desktop and mobile. This supports, but does not
prove, resource contention as the earlier cause. A successful run with L1
paused does not establish that the full gate fits alongside a syncing L1 node.
The existing skips were not changed or newly audited in this remediation.

Complete run output was retained locally at `/tmp/midgard-full-gate.log` and
`/tmp/midgard-isolated-gate.log`; these temporary files are not durable repository
artifacts. The results above are the durable summary. No benchmark, B2 overflow
fix, page-depth cap or storage redesign was performed in this window.

### Failures, skips and environmental constraints

- **Two real failures**, both in the root `frontend-new` gate, both in B1. The
  same code passes `pnpm check` in `frontend-new/app`, which is the mismatch B1
  records rather than a contradiction.
- **One environmental kill**, the development server, which produced H1. The
  process carried the audit's own out-of-memory adjustment, so the kernel chose
  it rather than the Cardano node. The machine behaved as configured.
- **Five backend test files skipped** with `REQUIRE_DB=1` set, all benchmark
  self-tests gated on variables nothing sets. M1.
- **Thirteen conditional skips** in the browser suite, five of them fixture
  dependent. M3.
- **Six background reviews were cut off** by an account rate limit early in the
  session and produced nothing. All areas were then audited directly, so no
  area rests on a partial agent result.
- **Machine load** ran between 2.5 and 5.0 on two cores for most of the session,
  with swap near capacity at times. No wall time recorded here is a measurement
  of the code, and the register's own timings should not be revised from them.

### Reported results carried over, not reproduced here

Kept separate on purpose. These were reported before this audit and were not
rerun.

| Reported | Status after this audit |
|---|---|
| Frontend check passed, 497 tests across 44 files | **Confirmed and reproducible as reported.** `pnpm check` in `frontend-new/app` passes at this commit, exit 0, with 497 tests across 44 files. An earlier draft of this page called that result impossible, which was wrong: it was reading the root `frontend-new` script, which is a different script. The gate is the root one, and it fails. Both statements are true at once, and that is the finding, not a discrepancy |
| Full browser suite: 474 passed, 19 skips, one timeout | Not rerun in full. The timeout's location and mechanism are consistent with L4 |
| Skips reviewed as complementary-project and viewport guards | **Corrected.** Eight of thirteen are. Five are fixture dependent. M3 |
| Backend address tests, 10 passed; backend type check passed | Confirmed inside the fresh full-suite and type-check runs |
| The certified before and after figures for the address change | Accepted as artifact evidence and not rerun. The `stress` counterpart predates them and is stale |

## 7. Stopping criteria

### When this audit is complete

It is complete now. It delivered a verified starting state, area verdicts
with the untested scope named, a findings register with evidence classes, an
execution plan and this ledger. It does not stay open for the four measurements
in section 5; those are tasks in the plan, not gaps in the audit. A finding that
needs a resource window is recorded as a hypothesis with the measurement that
would settle it, which is the honest terminal state for it.

This page is not reopened for new findings. A later finding belongs in the
register it concerns, or in a new dated page.

### When each improvement is complete

| Finding | Complete when |
|---|---|
| B1 | `./scripts/ci-local.sh` exits 0 from `frontend-new`, including the browser suite. That needs either M7 or a machine with more headroom than this one. A hosted run can only confirm it once the branch is pushed |
| B2 | Page width is not exceeded at 1280 px on `/deposits` and `/withdrawals` in both themes, an assertion at that width fails when the fix is reverted, and the visual review is approved |
| H1 | The ceiling matrix and the peak sweep both include the transaction route, and the per-mode minimum in the requirements page is restated from what they produce |
| H2 | A cross-origin build reports no policy violation for the vitals path, and a sample reaches the histogram |
| H3 | An advisory with no disposition fails the frontend gate, and the same advisory passes once recorded |
| H4 | A page past the cap answers 400 and issues no database statement |
| M1 | The benchmark self-tests either run in a workflow, or are recorded in the register as a named pre-baseline checklist |
| M2 | With the index database stopped and `REQUIRE_DB=1` set, the suite fails rather than reporting success |
| M3 | Removing the named fixture row fails the test that depends on it |
| M4 | One exported status function has three callers and the constant column is gone |
| M5 | An isolated measurement names the dominant contributor to backend peak resident memory. Complete when the mechanism is identified, not when the number moves |
| G1 | Three rows exist in the register with approved targets, and none of them reads `DISCOVERY` |

### The three dimensions the definition of done was missing

Added 2026-09-18, closing G1. Criterion 9 named eleven dimensions and none of
them was security, correctness invariants or accessibility, so B1, B2, H2 and
H3 could all have been outstanding while every stated condition for "done" was
met. A dimension with no row reads as a pass.

| Row | Target | How it is measured | State on 2026-09-18 |
|---|---|---|---|
| **Dependency advisories** | No production advisory without a recorded disposition, in either workspace | `backend/scripts/audit-gate.mjs` against `backend` and against `frontend-new`, both in their gates. The gate fails closed: an audit it cannot produce is an error, not a pass | **PASS.** Backend: 3 advisories, all dispositioned. Frontend: 0, after upgrading rather than accepting |
| **Accessibility** | Zero axe violations across the swept routes in both themes and both viewports, no regression from today's zero; plus WCAG 2.2 target size on interactive elements | `populated.spec.ts` for the axe sweep, `a11y-targets.spec.ts` for focus movement and pointer-target size. Target size is measured as the region that accepts a pointer, not as the painted box | **PASS.** Zero violations across 19 routes; skip link moves focus; information triggers accept a pointer over 43 x 43 px |
| **Correctness invariants** | Every invariant in section 4 holds, and each has a test that fails when the invariant is broken | The suites named against each invariant in section 4 | **PARTIAL.** The invariants hold as recorded; not every one has a test that fails when it is broken, and section 4 says which |

These are ratchets, not aspirations: each names today's measured value, so the
question at any later point is whether it still holds rather than whether
anybody has looked.

### How to avoid an expanding scope

Three rules, taken from what this repository already learned.

1. **A finding without a verification method is not ready to be worked on.**
   Every row above names one.
2. **A measurement task is finished when the mechanism is identified**, not when
   a number improves. The rejected heap cap improved a number and made the
   product worse.
3. **A dimension with no row reads as a pass.** That is why G1 is in the
   register rather than in a note, and why "keep it" is a valid decision but "no
   decision" is not.
