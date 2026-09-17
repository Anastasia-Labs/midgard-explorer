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

No application code was changed. The working tree is unchanged.

## 1. Executive verdict

**Ready.** The product is built. Correctness at the money layer is sound, every
security control reviewed held, the accessibility result is the strongest
evidence in this audit, and the developer surface is well built out. The backend passes its whole gate
today: type check, documentation gate, coverage lint, 813 tests against a real
database, 51 development-command tests, and the advisory gate.

**Not ready.** The branch does not pass the local gate that mirrors continuous
integration, `frontend-new/scripts/ci-local.sh`, and has not since `0bf26a8c` on
2026-09-16. That script stops at step three of eleven, so it never reaches the
type check, the unit tests, the production build or the browser suite. Nothing
is pushed and no workflow records were consulted, so this states nothing about
hosted runs. Two list
routes push the page sideways at the most common desktop width. The documented
memory minimum is wrong for the most-visited page in the application, by a
factor of about 2.5. Web Vitals cannot be collected at all in one of the two
documented deployment shapes.

**What prevents a defensible production-readiness claim.** Three things, in
order.

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

**Distance to the stated definition of done, as a forecast.** The plan requires
any rating stated before `FINAL-VERIFICATION` to be labelled a forecast, so this
is one. The implementation is close: the remaining work is one small correction
to restore the gate, one layout fix, three measurement reruns, and the depth cap
that the register has already named as the fallback for four failing rows.
The parts that cannot be closed from inside this repository are the upstream
index (`UR-1`) and the continuous integration sample sizes, which need calendar
time rather than work. The parts that are genuinely open are the backend memory
mechanism, which is still unidentified, and the stress profile, which fails
nine of twelve workloads and has not been rerun since the address fixes landed.

## 2. Six-area scorecard

### Rubric

No numeric scores are used. The programme's own rule is that a rating stated
before final verification is a forecast, and a number invites being quoted
without its caveats. Each area carries one of five verdicts.

| Verdict | Meaning |
|---|---|
| **Measured pass** | An acceptance criterion exists, and a fresh run or a named artifact meets it |
| **Partial** | A criterion exists, the checks that ran pass, and named gaps remain |
| **Measured fail** | A criterion exists and a measurement does not meet it |
| **Unmeasured** | No criterion, or a criterion with no measurement. This is not a pass |
| **Blocked** | A criterion exists and cannot be met without work owned elsewhere |

**Unmeasured is not a passing verdict.** Where an area is partly unmeasured the
untested scope is stated, because an area is only as strong as the part of it
that was actually exercised.

### Scorecard

| Area | Verdict | Evidence | Confidence | Untested scope |
|---|---|---|---|---|
| Correctness and data integrity | **Partial** | Money is `bigint` in the backend, a branded decimal string on the wire, and `BigInt()` in the browser. No float arithmetic on any amount. Balance reads every UTxO while only a page is returned and decoded. The UTxO cursor is validated with an even-length hex pattern at the route. History and UTxOs share one snapshot. Backend suite 813 passed with `REQUIRE_DB=1` | High for what was read | Conflicting-source reconciliation was not exercised against live data. The L1 indexer ingest paths were read, not run. No property-based test of the decoder against malformed CBOR |
| Security | **Partial** | No injection path found in the surfaces reviewed, which were every file in `db/` and `indexer/`: each `$queryRaw` is a tagged template, and the five `$queryRawUnsafe` sites bind `$n` placeholders with module constants. Nonce CSP with `strict-dynamic`, proved by a negative browser test that injects an unauthorised script. Read-only sessions set in code. CORS refuses `*` at boot in production. Rate limit keyed on the socket peer by default. Advisory gate passes fresh: three advisories, all with recorded dispositions | High for the surfaces read, which were all of `db/`, `indexer/` SQL, and `server/` | No live penetration test. No manual review of the transitive dependency tree beyond the advisory gate. The bundled nginx edge was read, not exercised |
| Performance and resource efficiency | **Measured fail on historical evidence** | All figures are historical and none is current. From `target-efc9af69.json`, dated 2026-09-05: backend peak resident memory 737.3 MB against 512 MB, and two of twelve `target` workloads fail. From `stress-5ded259a.json`, dated 2026-09-16: nine of twelve `stress` workloads fail, with `address-history` answering an error for every request. Continuous integration median 10.68 minutes against 8, over a window ending 2026-09-03. Section 3.6 reconciles these against the later results | High that these artifacts say this. Low that they describe the current head | Every later result was measured on a branch and none was preserved as an artifact. Compression was re-enabled at the edge and has no baseline. Two rows remain `DISCOVERY` |
| Maintainability and code quality | **Partial** | Type check clean across four packages. 813 backend, 497 frontend, 12 contracts, 3 tokens and 51 development-command tests pass. Duplication 0.90% against a 1.0% target. Dead weight inventoried and decided | High | Change complexity is a recorded `FAIL`. Five benchmark self-test files never run in CI. Five browser tests skip on fixture content rather than asserting it |
| Developer experience and operations | **Partial** | The one-command demo works exactly as documented: no backend, no Docker, no database, no secrets, ready in 521 ms. Documentation gate passes on 35 pages. `pnpm doctor`, the four readiness probes and the rollout script each carry their own reasoning | High | A genuinely fresh clone and install was not performed. The full stack mode is documented as not measured and remains so |
| Usability and accessibility | **Partial** | 76 page loads across 19 routes, two themes and two viewports: **zero axe violations** under `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. Zero unnamed interactive elements. One `h1`, one `main` and a working skip link on every page. A visible 2 px focus outline on every one of fourteen keyboard stops. Correct `tablist` semantics. Real 404 status codes | High, and this is the best-evidenced area in the audit | Screen reader behaviour was not tested with a real assistive technology. Contrast ratios were not computed token by token; axe checked rendered contrast and found none failing |

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
- **Care needed.** The obvious fix, reusing the running server, is the one the
  Playwright configuration deliberately refuses by default, and its comment
  explains why: adopting a server someone else started has already produced a
  green run against code that no longer existed. The safe shape is the reverse.
  Let the browser stage own the single build, and have the gate skip its own
  build step when it is about to run the browser suite, so there is still
  exactly one build of exactly the code under test.
- **Verification.** The full gate completes with one build in its log, and the
  `--fast` path still builds.

### 3.4 Low

| ID | Finding | Evidence | Remedy |
|---|---|---|---|
| L1 | The skip link does not move focus. `<main id="main">` carries no `tabindex`, so after activating it `document.activeElement` is `body`. Chromium's sequential focus starting point still sends the next Tab into `main`, so Tab users are served; assistive technology and other engines are less certain | Reproduced | `tabIndex={-1}` on `main`. Assert `document.activeElement.id` is `main` after activation |
| L2 | Information triggers measure 16 x 16 px, below the 24 x 24 px minimum in WCAG 2.2 success criterion 2.5.8. Up to 84 sub-24 px interactive elements were counted on one page at 375 px. axe ran with 2.0 and 2.1 tags, which do not include 2.5.8, so zero violations is consistent with this | Reproduced | Pad the trigger to 24 x 24 without changing the glyph |
| L3 | The node migration hazard is real and undocumented here. The live node database records **12** rows in `schema_migrations` while the node checkout declares **one** SQL migration. The node's runner tracks checksum mismatches and has a `verification_failed` state, so a rebuild against the existing volume is expected to fail verification. This repository documents how to run the node and has a page for exactly this class of problem | Reproduced (counted both sides; the rebuild was not attempted) | A short section in `upstream-node-defects.md` |
| L4 | `../frontend-new/app/e2e/utxo-flow.spec.ts` gives a 503-node layout a fixed 15 second budget. That is a wall-clock assertion on CPU-bound work, on a two-core machine, and is the most likely source of the single reported timeout | Source-confirmed | Raise the budget for the complementary projects, or assert on a worker completion signal rather than elapsed time |
| L5 | The documentation gate resolves links against the working tree rather than against tracked files, so a tracked page linking into a git-excluded path would pass locally and be dead in a fresh clone. No tracked page currently does this, so the weakness is latent | Source-confirmed | Resolve link targets against `git ls-files` |
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

- **682.6 MB.** This is a **test suite** peak recorded during the address paging
  work on 2026-09-17. It is not a `target` profile benchmark peak, so it does not
  replace 737.3 MB; the two measure different processes doing different work. No
  file under `performance/baselines/` records it. Both figures are above the
  512 MB target, so the verdict is the same either way and only the magnitude is
  unsettled.
- **Passing target workloads.** The two failures in `efc9af69` are `block-detail`
  on route statements and `transactions-list-page-deep` on temporary I/O. The
  register states that `0bcc98d5` and `a66273e6` target exactly those two, that
  they were measured on their own branches, and that "these rows keep this run's
  figures until a rerun records them". Those branch measurements were not
  preserved, so there is no artifact showing the post-fix result.

**What this means for the verdict.** The performance area is marked **measured
fail on historical evidence** rather than measured fail. The failures are real in
the artifacts that exist, later work has plausibly moved at least three of them,
and no artifact settles it. This strengthens the case for the canonical target
rerun in section 5 rather than weakening it: that rerun is the only thing that
converts this area from historical to current.

**The stress figures are the stalest.** `stress-5ded259a.json` was built from a
commit that predates `0bcc98d5`, `a66273e6` and the address filter pushdown in
`2e3b2f09`. Its worst row, `address-history` failing every request while writing
6.2 GB of temporary files per request, is the exact query `2e3b2f09` repaired.
Nobody knows what that row reads today.

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

1. **Restore the gate (B1).** Extra small. Every later step in this list is
   verified by this same script, so it has to pass in one run before the rest
   can be checked the way the repository checks things.
2. **Bound the table scroll container and widen the assertion (B2).** Small.
   A visual change, so it needs visual review before step 3.
3. **Cap the page depth (H4).** Small. No measurement needed, it closes an
   availability exposure, and it is the half of `CURSOR-PAGINATION` that stands
   on its own.

### Fits in one hour

- B1, the gate.
- H3, the frontend advisory gate.
- M2, make the reachability guard fail under `REQUIRE_DB`.
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

| Task | Command | Resource need | Expected duration |
|---|---|---|---|
| **Measure** the development memory peak for the transaction route (H1) | `measure.mjs limit 1024`, then 1536 and 2048, with the transaction route in the swept set | 2 cores, 3 GB free | 30 minutes |
| **Measure** the isolated address-balance peak (M5) | `pnpm bench --only address-history --mode baseline --iterations 1000` at `target`, reading `peakRssBytes` | quiet machine, 3.5 GB available | 40 minutes |
| **Measure** the canonical target rerun at the current head | `pnpm bench --profile target --mode baseline --iterations 1000 --with-frontend` | quiet machine, 4 GB available | 60 minutes |
| **Measure** the stress retry after the address fixes | `pnpm bench --profile stress --mode baseline --iterations 1000` | quiet machine, 3.5 GB available, 30 GB disk | 70 minutes, 10 of them seeding |

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
| The gate, in full | `frontend-new` | `./scripts/ci-local.sh` | **Did not complete**, exit 1 at 290 s. Ten steps passed. The browser stage never started: its web server ran a second `next build` and the kernel killed it, exit 137 |

**The full gate's failure is a machine result, not a code result, and it is not a
pass.** The browser suite did not run, so nothing here says it would have passed.
Two things caused it, and only one of them is the machine:

- This box had about 1.8 GB available with the Cardano node resident at 4.3 GB,
  and the run carried an out-of-memory adjustment that deliberately makes it the
  kernel's first choice. A runner with more memory would not necessarily hit it.
- **The gate builds the application twice.** Step ten runs `next build`. The
  browser stage then starts Playwright, whose web server configuration is
  `pnpm build && pnpm start`, so it builds again from scratch. The second build
  is what was killed. See M7.

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
  session and produced nothing. All six areas were then audited directly, so no
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

It is complete now. It delivered a verified starting state, six area verdicts
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
