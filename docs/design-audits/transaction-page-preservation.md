# Transaction page preservation checklist

## Scope and checkpoint

Preservation checklist for the approved transaction-page facelift.
Scope: the Midgard detail route `/transaction/[txHash]`, not the transaction list or Cardano detail route.
The original inventory is retained below. The revised layout is implemented and awaiting visual approval.

## Current reading order

1. Identity, resolved outcome, key figures and supported action summary.
2. Pending progress and settlement warnings when applicable.
3. Overview / Scripts (when evidence is present) / Technical details / Raw tabs.
4. Overview: Table / Flow, optional net movement, compact matched Cardano settlement.
5. Technical details: ledger metadata, mint/burn, reference inputs, authorization and settlement evidence. Empty authorization fields are collapsed; finalized stage history is in settlement evidence.
6. Raw: API example, CBOR and JSON exports.

## Content preservation map

| Content | Current owner | Planned placement / invariant |
|---|---|---|
| Full transaction ID, copy, mobile truncation | `IdentityBar` | Compact identity header; copy always returns the complete ID |
| One lifecycle outcome | `transactionJourney`, `ToneBadge` | Header; do not add a conflicting raw-status or ledger-validity badge |
| Inclusion link and pending state | transaction route | Key figures; distinguish missing inclusion from missing block height |
| Relative and exact time | `Timestamp` | Key figures; use shared formatting |
| Total output, all assets, fee, size | `totalOutputValue`, `ValueCell`, `AdaAmount` | Key figures; total output is not net transferred value |
| Supported action summary | `ActionSummary` | Near the header; omit unsupported recipient inference |
| Inputs / outputs and complete asset quantities | `StateTab` | Default visible movement section with input/output counts |
| Incomplete resolution and balance warnings | `ledgerEquation`, `NetMovement` | Remove repeated equation display; keep unknown values explicit, unbalanced warning visible, and address deltas optional |
| Table / Flow choice | `ViewToggle`, `UtxoFlow` | Prominent movement toolbar; preserve complete Table fallback |
| Input references, addresses, credentials | `StateTab`, shared tab helpers | Preserve links and expandable credentials |
| Output consumption, datum indicators, reference scripts | `OutputState`, `ReferenceScript` | Preserve in the movement table |
| Mint / burn quantities and policy fallback | `OverviewTab` | Retain accessible asset details; preserve signs and policy-only decode fallback |
| Reference inputs and resolution warnings | `OverviewTab` | Retain separately from spent inputs |
| Ledger validity, validity interval, network, format, witness counts | `OverviewTab` | Technical details; validity remains distinct from lifecycle |
| Required signers / observers, integrity and auxiliary-data hashes | shared tab helpers | Technical details; preserve explicit absence states |
| Journey steps, admission attempts, requests and submit source | `Journey` and route | Lifecycle section; critical rejection evidence stays visible |
| Settlement link, source evidence and observation times | `CardanoAssociation` | L1 section with blue identity accents; conflict/stale warnings keep their status colors |
| Datums mapped to output index/address, scripts, redeemers | `DatumPanel`, `WitnessPanel` | Conditional technical tab |
| Script invocations and execution budgets | `TransactionEvents` | Preserve; do not imply a complete protocol event log |
| API example, raw JSON download, CBOR, truncation and missing bytes | Raw tab components | Preserve inspection and export paths |

## URL and keyboard contract

- Validate transaction IDs with `isHash32`; normalize valid IDs to lowercase for fetching.
- Preserve `/transaction/[txHash]`, `/block/[headerHash]`, address, asset and settlement destinations.
- Tab IDs: `summary` (default), conditional `scripts`, `details`, `raw`. Legacy `utxo` maps to `summary`; `datums` and `events` map to `scripts` (or Overview when no script evidence exists).
- Movement choice uses `view=table` (default / absent) or `view=flow`.
- Existing `?tab=utxo&view=flow` bookmarks must still reach Flow after movement becomes default-visible.
- Preserve unrelated query parameters, reload persistence, arrow-key selection and visible focus.
- Resolve unavailable conditional tabs and unknown values predictably. Current components fall back to their first entry.
- Do not change shared Tabs defaults for every route to implement one page's redesign.

## State matrix to verify during implementation

| Case | Required behavior |
|---|---|
| Malformed ID / not found | Preserve 404 behavior |
| API failure | Keep identity and retry/error presentation |
| Pending with no decoded body | Lifecycle evidence and pending explanation remain usable |
| Rejected with no body | Reason code/detail and reliable rejection timestamp remain visible |
| Decode failure | Explicit warning; retain available lifecycle and source evidence |
| Decoded pending / committed / finalized | One resolved lifecycle answer, appropriate links and movement |
| Abandoned settlement or source disagreement | Visible warning; no invented successful settlement |
| Partial/unresolved inputs | Show uncertainty in table, equation, summary and flow |
| Mint/burn/reference/script transaction | Preserve signs, identities, script data and execution budgets |
| Missing/truncated CBOR | Keep absence/truncation explicit and preserve available exports |
| Large transaction | Fitted flow first; explicit expansion for all nodes and complete Table fallback |
| Empty assets / no scripts | No misleading empty analytics panels |

## Findings requiring deliberate treatment

1. **Movement discoverability:** State hides the central inputs/outputs view behind a tab. Expose the existing component rather than create a second renderer.
2. **Repeated time:** the timestamp appears in both the header and Technical details. Choose one primary display in the facelift.
3. **Polling scope:** `TERMINAL_TX_STATUSES` includes committed and rejected. `LifecyclePoller` refreshes every five seconds only outside that set, pauses in hidden tabs and refreshes on return. A committed record may still acquire finalization evidence. Investigate a settlement-aware refresh rule separately; do not silently change lifecycle semantics during header styling.
4. **Events vocabulary:** the tab count uses redeemers while its content presents script invocations. Review label/count agreement; do not advertise generic chain events.
5. **Color meaning:** use blue for L1 identity, green for L2 identity, and retain warning/failure colors for outcomes. Do not recolor all text or financial values.
6. **Data integrity:** no new amount arithmetic, net-recipient inference, settlement reconciliation or flow routing model is required for the facelift. Reuse existing domain functions and BigInt handling.

## Implementation sequence and approval gates

- [x] Inventory source content, states, components and URL behavior.
- [x] Review checkpoint for this inventory.
- [x] Refine transaction identity, outcome and key figures; visual approval.
- [ ] Expose inputs/outputs and Table / Flow on the default view with compatible URLs; implemented, awaiting visual approval.
- [ ] Reorganize lifecycle, Cardano evidence and technical sections; implemented, awaiting visual approval.
- [ ] Verify both themes, mobile widths, keyboard access, state fixtures and large transactions.

Use existing transaction, association and flow tests for preserved invariants. Update layout-specific assertions to match approved behavior. Run browser checks against populated and failure fixtures before calling the visual and accessibility review complete.

## Source pointers

- [Route](../../frontend-new/app/src/app/transaction/[txHash]/page.tsx)
- [Overview content](../../frontend-new/app/src/features/transaction/tabs/OverviewTab.tsx)
- [Movement content](../../frontend-new/app/src/features/transaction/tabs/StateTab.tsx)
- [Action summary](../../frontend-new/app/src/features/transaction/ActionSummary.tsx)
- [Lifecycle polling](../../frontend-new/app/src/features/transaction/LifecyclePoller.tsx)
- [URL tabs](../../frontend-new/app/src/components/ui/base/tabs.tsx)
- [View toggle](../../frontend-new/app/src/components/ui/base/viewtoggle.tsx)
- [Flow behavior tests](../../frontend-new/app/e2e/utxo-flow.spec.ts)

## Verification of this revision

- TypeScript and scoped lint pass.
- 127 focused tests pass across flow, ledger, components, journey and association panels, including compact agreement and mismatch evidence preservation.
- Local populated transaction browser checks pass in light and dark themes: Table/Flow, keyboard tabs, evidence disclosure, Raw and legacy URLs. Desktop Overview has zero axe violations in both themes; 393px mobile has no horizontal page overflow.
- Full production fixture and large-transaction browser matrix remains outstanding; local checks do not replace that matrix.

## Credential previews and Scripts review

- Payment/stake icons use hover/focus previews with copy, Escape dismissal and mobile tap support. Replaced the address-wide UTxO shortcut with a hover preview of the specific row reference, value and available output status.
- Scripts gathers invocation evidence, witness bytes and output datums. Redeemers appear once, with decoded/CBOR copy support and execution budgets. Source resolution is unchanged; no logs or contract identities are inferred.
- Live local data has no script-bearing transactions. Populated fixture rendering tests cover Scripts and legacy links; browser verification of a populated Scripts tab remains outstanding.

## Asset activity review

- Mint/burn panel moved from Technical details to Overview, before the movement views; no duplicate panel.
- Exact signed quantities and asset links are preserved. Policy-only decoding has an explicit unavailable-quantity message.
- UTxO previews pass local browser checks in both themes, including hover, keyboard, mobile and axe. Mint/burn is fixture-tested; the local chain currently has no mint transactions.
