# Explorer feedback implementation plan

Updated: 2026-08-12

## The verified run this document reports

Every figure below comes from this one sequence, run in this order on
2026-08-12. Earlier versions of this document mixed figures from different
runs, reporting backend 221, frontend 366 and e2e 344 in one paragraph and 360
in another, which makes the numbers unusable as evidence. One run, or none.

| Check | Command | Result |
|---|---|---|
| Backend types | `pnpm exec tsc --noEmit` | 0 errors |
| Backend tests | `pnpm test` | 236 passed, 28 files |
| Frontend types | `pnpm exec tsc --noEmit` | 0 errors |
| Frontend lint | `pnpm lint` | 0 errors |
| Frontend tests | `pnpm test` | 386 passed, 28 files |
| End to end | `pnpm test:e2e` | 370 passed, 14 skipped, 0 failed, exit 0, 6.2m |
| Canvas reliability | `pnpm test:canvas-reliability` | 20/20, 1948MB free at the tightest, peak load 5.64 |

## How this document scores itself

Four axes, each evaluated on its own evidence. There is no aggregate figure and
no average, because a strong functional score concealed visual and reliability
debt for three consecutive rounds of this document: every capability was present
and marked complete while the flow was visually flat, the API surface was
declared in four places, and the suite failed on a loaded machine.

Every axis row carries scope, acceptance criteria, evidence, status and known
gaps. A capability may be excluded from the functional axis only when Midgard or
Cardano has no equivalent; the exclusion and the replacement shown to users must
be recorded under `Protocol decisions`.

**Release readiness requires zero open P0 items on every axis, whatever the
other statuses say.** A P0 is anything that would mislead a viewer about the
chain, expose the service, or make the gate unable to detect a regression.

| Axis | Status | Open P0 |
|---|---|---|
| Functional and protocol coverage | complete for the agreed scope | none |
| Reliability and release correctness | clean at 20/20 | none |
| Maintainability | one gap, named below | none |
| Visual and interaction quality | improved, composition pass landed | none |

### Axis 1: functional and protocol coverage

- **Scope:** every capability in the feedback matrix below that Midgard or
  Cardano can honestly support.
- **Acceptance:** implemented, covered by automated tests, verified in a
  production build on desktop and mobile.
- **Evidence:** the matrix below, plus the verified run at the top of this
  document.
- **Status:** complete for the agreed scope.
- **Known gaps:** none within scope. Known-address labelling covers L1
  validators only. Analytics beyond the operations panel is deferred until live
  data would make a chart mean anything.
- **Closed 2026-08-12, Cardano link policy.** The explorer was linking L1
  hashes in the wrong direction. Deposits, withdrawals, forced transactions and
  journey evidence, which are exactly the transactions we hold Midgard
  interpretation for, went out to Cardanoscan; the one internal link was on a
  consumed input's source transaction, which is ordinary Cardano provenance we
  hold nothing about and which answered with the application's not-found page.
  `L1TxLink` now requires `destination="midgard" | "cardano"` with no default,
  so all seven call sites declare it, and the internal page renders "No Midgard
  record for this transaction" with a link out instead of a 404. The external
  address is a template, `NEXT_PUBLIC_L1_EXPLORER_TX_URL` containing `{hash}`,
  because a configurable base with a hard-coded `/transaction/` path only ever
  addressed explorers that route the way Cardanoscan does. CExplorer serves
  `/tx/…`, so the deployment supplies the whole shape and a display name.

### Axis 2: reliability and release correctness

- **Scope:** the gate's ability to detect a regression, on a cold machine and a
  loaded one.
- **Acceptance:** no flake in the canvas path across 20 fresh-profile
  iterations; no run can adopt a foreign server; every readiness wait keys on an
  explicit state rather than a timeout.
- **Evidence:** the canvas now publishes `data-canvas-state` as idle, loading,
  ready or error, and every wait keys on it. Server reuse is opt-in, the default
  ports are the suite's own, and global setup proves the identity of both the
  fixture and the app. `pnpm test:canvas-reliability` runs the canvas path 20
  times against a restarted server, each iteration in a new Playwright process
  and therefore a new Chromium with an empty cache. See the verified run above.
- **Status:** clean at 20/20.
- **Closed 2026-08-12.** The gate reports resources, so a verdict can be
  checked rather than trusted: memory available per iteration, peak load, and a
  separate classification for any failure under 1024MB free. The clean run held
  1948MB at its tightest with peak load 5.64, so nothing in it is attributable
  to starvation.
- **Corrected 2026-08-12, three harness defects that made green meaningless.**

  1. `PLAYWRIGHT_BROWSERS_PROFILE` was an invented variable. Playwright does not
     read it, so the temporary directory the gate created had no effect and the
     cold-browser claim rested on a mechanism that did not exist. The isolation
     was real, but it came from Playwright launching a fresh browser per
     process. The variable is gone and the actual mechanism is documented.
  2. Teardown killed whatever held the port with `kill -9`. A harness written to
     avoid adopting a foreign service would instead have destroyed one. It now
     refuses to start on an occupied port, walks `/proc` for the descendants of
     what it spawned, sends SIGTERM to that set, and escalates only within it.
  3. `pnpm test:e2e` had never run from a clean shell. The fixture defaults to
     port 3101, `helpers.ts` defaults to 3101, and `playwright.config.ts`
     defaults to 3211 and waits there, so a clean shell got a 60 second
     webServer timeout and zero tests. Every green e2e figure this branch
     reported came from a shell that happened to export `FIXTURE_PORT`. The
     config resolves the port once and publishes it to the fixture subprocess
     and to the workers.

- **Known gaps:** three tests failed on the loaded box during a 13.5 minute run
  and passed in isolation at 350ms, 375ms and 2.8s, against 30 second timeouts.
  The clean 6.2 minute run passed all three. They are recorded as observed under
  load rather than as cleared, because passing on rerun is not evidence.

### Axis 3: maintainability

- **Scope:** how many places a fact has to be changed.
- **Acceptance:** one owner per fact. Routes, their documentation and their
  tests derive from one declaration.
- **Evidence:** the API surface was declared four times until 2026-08-11:
  `routes.ts` registered it, `openapi.ts` described it, `openapi.test.mts`
  asserted it against a literal copy of itself, and `apiDocs.ts` listed it again
  for the docs page. Adding a route took four edits and the only drift a test
  could catch was between the document and its own copy. The two transaction
  route files were 741 and 642 lines and mixed data resolution with
  presentation.
- **Status:** improved, one gap left.
- **Closed 2026-08-12, the lint gate.** `pnpm lint` ran `next lint`, which Next
  16 removed, so the command exited successfully while checking nothing. A flat
  config restored it and it reported five React Compiler errors. All five are
  fixed by removing the pattern rather than suppressing the rule, and two of
  them were real defects rather than style: the canvas reset its positions from
  an effect, so a new transaction rendered once against the previous
  transaction's coordinates, and the search overlay blanked its suggestions from
  an effect, so the previous query's hits showed for one render under the new
  query's text. Both are now derived during render, the canvas by tagging the
  layout with the graph it was computed for and the search by storing the answer
  with the query it answers. `useHydrated` replaces the `useState` plus
  `useEffect(setMounted)` idiom with `useSyncExternalStore` and separate server
  and client snapshots.
- **Known gaps:** response shapes stay forked until the backend can import
  `@midgard-explorer/contracts`, which is a packaging decision outside this
  work. Closed on 2026-08-11: the endpoint catalogue in
  `backend/src/server/catalogue.ts` now owns registration, and the OpenAPI
  document, the rate-limit mounts and the reference page all derive from it, so
  the surface is declared once rather than four times. The two route files went
  from 741 and 642 lines to 352 and 230, with their sections moved into
  `features/transaction/tabs` and `features/l1transaction`.

### Open: development-only defects the production gate cannot see

The e2e suite fails on any console error, and it runs a production build. React
performs its hydration attribute comparison only in development, so a defect in
that class is structurally invisible to the gate: the nonce mismatch on the
pre-paint theme script sat in the tree while the suite reported zero console
errors on every route.

The cause was not ours. Nonce hiding is defined platform behaviour: the browser
blanks the content attribute once it has parsed the element, so
`getAttribute("nonce")` reads empty while the property keeps the value, and
React has no way to tell that deliberate transformation apart from a real
mismatch. `suppressHydrationWarning` on that one element is the documented
escape hatch. It would equally silence a genuinely wrong nonce, so the
guarantee it used to provide incidentally is now asserted on purpose in
`e2e/security-headers.spec.ts`: the header nonce equals `script.nonce`, the
script executes, and an inline script injected into the served HTML without the
nonce is refused. Those run in production, where they are deterministic.

`pnpm check:dev-console` is a separate smoke gate that loads four routes on a
development server and fails on any console or page error. It is deliberately
not part of the canvas reliability script: the two exercise different runtime
modes and different failure classes.

**It does not currently guard the nonce defect, and should not be described as
if it does.** The original reproduction was three A/B cycles against a
long-running development server, toggling the attribute, 0 then 1 then 0
console errors. On a freshly started server the same toggle produces no error,
and it stayed silent with a live fixture API and after a forced hot update. The
working hypothesis is that whether React renders the nonce as an attribute or a
property varies with streaming order, which varies with how much the server has
compiled. That is a hypothesis, not a finding.

The gate earns its place on other evidence. Building it exposed a false-clean
mode worth more than the test it was written for: Next allows one development
server per project directory, recorded in `.next/dev/lock`, and a second one
serves pages and answers 200 while owning neither hot reload nor hydration
reporting. Run beside one, the gate reported four clean routes. It now refuses
to start when another server holds the lock, and checks again after startup.

### Measured: React Flow stylesheet delivery

Recorded because the experiment was expected to fail and did not. Before, the
production build emitted one stylesheet of 66,866 bytes carrying 160
`react-flow` selectors, requested by every route. Moving the import out of the
root layout and into the canvas component split it into two chunks: 15,413
bytes of graph styling that travels with the dynamically imported canvas, and
51,726 bytes for everything else. Verified from the served HTML: `/blocks` and
`/transactions` now request only the second. The change is kept.

### Axis 4: visual and interaction quality

- **Scope:** whether the explorer reads as considered, against the reference
  sites the feedback named.
- **Acceptance:** a reader can tell what a diagram encodes without reading the
  legend twice; no view wastes half its width; colour means one thing per
  viewport.
- **Evidence:** desktop and phone captures of the transaction flow at 1440 and
  390. The fitted diagram, value-weighted coloured edges and the stacked mobile
  layout are a substantial improvement over the pannable canvas that preceded
  them.
- **Status:** improved, composition pass landed 2026-08-12.
- **Known gaps:** motion is still limited to functional feedback, which is a
  deliberate choice for an operations tool rather than an omission. Closed: the
  diagram is bounded at 62rem and centred instead of stretching to the viewport;
  stacked cards fill a phone's width; the line legend renders only in the view
  that draws lines; and script and key edges use `--mg-graph-script` and
  `--mg-graph-key` rather than the accent, which held the same value as
  `--mg-success` and made a script edge the colour of a validity badge.

## Delivery order

1. Security and trust boundaries
2. Reachable Cardano L1 transaction details
3. Collision-safe help and a shared field glossary
4. Complete Midgard transaction data and semantic iconography
5. Scalable interactive graph visualization
6. Purposeful live updates and motion
7. Full verification and release evidence

## Completion matrix

### Core explorer

- [x] Network overview and health verdict
- [x] Block list, detail, settlement evidence, and adjacent navigation
- [x] Transaction list, detail, lifecycle, filtering, paging, and export
- [x] Address balance, assets, UTxOs, and transaction history
- [x] Native asset list, fingerprint, supply, and holders
- [x] Deposits, withdrawals, and forced transactions
- [x] Search for transactions, blocks, addresses, units, and fingerprints
- [x] Linkable tabs, responsive tables, theme support, loading, and error states

### Transaction investigation

- [x] Transaction identity, validity, fee, time, size, and network
- [x] Inclusion and Cardano L1 finalization journey
- [x] Complete input/output table and honest unresolved-input state
- [x] Ledger equation and per-address/per-asset movement
- [x] Decoded and raw inline datums
- [x] Witness scripts, redeemers, purpose/index, and execution units
- [x] Mint and burn quantities
- [x] Raw JSON, API request, and bounded raw CBOR download
- [x] Resolved reference-input values and links
- [x] Collateral inputs and collateral return, with the native-v1 exclusion shown
- [x] Metadata/CIP-20 body availability and auxiliary-data hash
- [x] Certificates, observer-withdrawals, and governance availability
- [x] Payment and stake credential hashes
- [x] Produced and current-ledger UTxO state, consumed-by links when indexed,
      and an explicit unavailable state otherwise
- [x] Protocol events only from authoritative records, with no fabricated logs
- [x] Script bytes, reference-script details, and verification provenance
- [x] Execution/state-transition commitment and per-transaction trace availability

### Cardano L1 investigation

- [x] L1 activity list and deployment/source identity
- [x] Backend contract for inputs, outputs, assets, datums, reference scripts,
      collateral, collateral return, mints, and redeemers
- [x] Linked L1 transaction-detail route
- [x] L1 overview, UTxO, contracts, collateral, mint/burn, events, and raw tabs
- [x] Links to the configured external Cardano explorer

### Help and iconography

- [x] Shared status registry and accessible status explanations
- [x] Keyboard, click/touch, Escape, and minimum-target support
- [x] Pointer-hover support with delayed open/close
- [x] Portal-based, collision-safe positioning on every viewport
- [x] Shared glossary entry for every unfamiliar field and icon
- [x] Meaning plus consequence in every explanation
- [x] Consistent icons for credentials, UTxOs, datums, scripts, collateral,
      mint/burn, metadata, and consumed-by relationships

### Visualization and live behavior

- [x] Accurate static UTxO flow with semantic table fallback
- [x] Rich expandable transaction nodes
- [x] React Flow viewport, keyboard navigation, pan, zoom, fit, and minimap
- [x] ELK layered layout in a worker when graph topology requires it
- [x] Progressive disclosure, clustering, and a bounded initial node count
- [x] Visible-node rendering and measured hundred-node performance budget
- [x] Live block and transaction updates backed by server events or polling
- [x] State-change animation with no decorative perpetual motion
- [x] Complete reduced-motion behavior and nonvisual data alternative

### Security and release gates

- [x] Runtime response-schema validation and parameterized database queries
- [x] Bounded raw payloads, safe integer strings, and explicit partial decode
- [x] Production CORS refusal and JSON API security headers
- [x] Trusted-proxy boundary for forwarded client addresses
- [x] Rate limiting for transaction decode and every other measured expensive route
- [x] Frontend CSP, HSTS, frame, referrer, and permissions headers
- [x] Zero untriaged production dependency advisories
- [x] Unit, contract, backend, production E2E, accessibility, responsive, and
      performance gates all pass

## Protocol decisions

- Ethereum event logs are not copied as a label or fabricated from UI data.
  Midgard exposes `Protocol events` only when the node or indexer provides an
  authoritative event, datum, redeemer, or metadata record.
- Ethereum internal transactions, gas fields, nonce changes, and EVM storage
  diffs are excluded because they are account/EVM concepts. Their relevant
  Midgard replacements are the UTxO state transition, native-asset movement,
  script execution, and L1 settlement journey.
- Midgard native transaction version 1 rejects Cardano collateral, certificates,
  governance procedures, non-zero withdrawals, auxiliary-data bodies, and
  Plutus datum witnesses. The Details tab shows those exclusions. Zero-value
  withdrawal scripts survive as required observers; an auxiliary-data hash is
  shown when present, but metadata and CIP-20 text are not guessed from it.
- The node stores the current UTxO ledger but no historical outref-to-spender
  index. The explorer proves `unspent` when the current ledger resolves an
  output, links `consumed by` when an authoritative index supplies it, and
  otherwise says `not in current ledger` rather than conflating consumption
  with pruning.
- Transition traces are committed by a block-level root. Until the node exposes
  a transaction-to-step proof, the explorer shows the commitment-only state
  rather than presenting a reconstructed animation as an execution trace.
- The complete table remains the default and accessibility fallback. The graph
  summarizes and navigates the same facts; it never invents an edge from a
  particular input to a particular output.
- Three-dimensional or ambient visualization is optional and cannot delay,
  obscure, or replace the investigation workflow.

## Implemented native-v1 replacements

The L2 Details tab now exposes required signer and observer hashes,
script-integrity and auxiliary-data commitments, reference-input values,
credential hashes, output current-ledger state, script bytes with recomputed
hash provenance, and typed availability for every Cardano-only section above.

## Visualization and live-update evidence

- The table is the default complete representation. Flow starts with at most 12
  UTxOs per side plus truthful remainder clusters and reveals all nodes only on
  an explicit command.
- React Flow supplies keyboard-focusable nodes, pan, zoom, fit, controls, and an
  interactive minimap. Viewport rendering is enabled above 100 graph nodes.
- The pinned ELK layered engine runs in a same-origin Web Worker only when graph
  topology requires layered routing. It receives topology and geometry only,
  not transaction contents. A single-transaction UTxO star cannot have edge
  crossings, so even the 503-node stress graph uses immediate deterministic
  transaction columns instead of paying the worker cost.
- Unit gates construct and position 100- and 500-output graphs. The production
  desktop/mobile gate reveals, lays out, fits, and virtualizes 503 nodes in less
  than the 15-second end-to-end budget.
- The overview polls blocks and transactions every 10 seconds, holds new rows
  behind a reader-controlled banner, and polls health every 30 seconds.
  Non-terminal transactions refresh every 5 seconds and pause while hidden.
- Motion is limited to a bounded changed-value tint, newly applied row tint,
  popover/loading feedback, and graph position changes. Reduced-motion collapses
  every transition/animation, while the table remains the nonvisual alternative.

## Release evidence

The figures are the verified run at the top of this document and are not
repeated here, because keeping a second copy is how this section came to report
totals three runs out of date.

- Backend TypeScript passed and vendored-core provenance passed 3/3.
- All frontend workspace packages typechecked, and `pnpm lint` passed, which it
  had not done since Next 16 removed `next lint`.
- The 14 skipped E2E cases are deliberate project exclusions: desktop-only
  layout matrices and desktop keyboard shortcuts are not rerun in the mobile
  project.
- Accessibility audits cover populated and degraded routes, all new transaction
  tabs, L1 detail, Tools, tooltips, Flow, and both light/dark themes. Responsive
  gates include 320 px, phone, tablet, and desktop widths.
- The normal Next.js Turbopack production build passed without specimen routes
  or candidate-font warnings; those review-only assets were removed.
- Live production audits for both frontend and backend lockfiles reported no
  known vulnerabilities.
- Deterministic graph tests cover 100 and 500 outputs. Production desktop/mobile
  503-node reveal tests stayed below the 15-second navigation-to-render budget,
  with viewport culling limiting mounted rich cards.
- Final screenshots at 1440×1000 and 390×844 showed readable transaction and
  UTxO cards, no horizontal overflow, usable controls, a desktop-only minimap,
  and the complete table alternative. Reduced-motion production tests passed
  in both projects.

The exclusions in `Protocol decisions` are protocol mismatches, not unfinished
UI: the explorer shows an explicit unavailable or commitment-only state instead
of inventing EVM logs, Cardano fields rejected by native transaction v1, or
historical spender evidence the node does not index.

That covers the functional axis only. Read the four axes at the top of this
document for the rest, and do not restate any of them as a single figure. Two
axes are open, and the release gate is zero open P0 items rather than a score.
