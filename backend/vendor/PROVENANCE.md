# Vendored dependency provenance

## `@al-ft/midgard-core`

| | |
|---|---|
| File | `vendor/al-ft-midgard-core.tgz` |
| sha256 | `8f488be84d8343e0440cb664ff6ac5185b60bde0b0dc303200c57a749f69ada5` |
| Size | 119,506 bytes |
| Tarball mtime | 2026-06-08 17:47 local |
| Self-reported version | `0.1.0` |
| `gitHead` in its package.json | absent |
| Built against | `@lucid-evolution/lucid` `0.4.31`, `@noble/hashes` `^2.0.1`, `cborg` `^4.5.8` |
| Source repository | `/home/harun/dev/cardano/AnastasiaLabs/midgard`, package `demo/midgard-core` |

### Which commit this came from is not established

The tarball carries no `gitHead` and the version string has been `0.1.0` for
every build ever made of this package, so neither field identifies the code.
The only evidence is the file's mtime, 2026-06-08.

The last commit touching `demo/midgard-core` before that date is
`c015752e58a80a8ec9795eeeae688006ca41a0b2` (2026-06-02, "chore: commit remaining
local changes"). That is **inferred from timestamps, not verified**. Treat it as
a starting point for a bisect, not as the answer.

The fix is upstream: publish the package with a `gitHead`, or record the commit
at pack time. Until then the sha256 above is the only reliable identity, and
`pnpm verify:vendor` is what checks it.

### Replacing the tarball

Update the sha256 here and in `test/vendor-provenance.test.mts` in the **same
commit** that replaces the file, and state which Midgard commit it was built
from. A tarball swap with no provenance change is the drift this record exists
to catch.

## Version gap that blocks the codec migration

| Package | Lucid version |
|---|---|
| Vendored `@al-ft/midgard-core` (this tarball) | `0.4.31` |
| Current `demo/midgard-core` in Midgard | `0.6.0` |
| Current `@al-ft/midgard-sdk` in Midgard | `0.6.0` |
| This backend (`devDependency`) | `0.4.31` |

All of them self-report package version `0.1.0`, so the Lucid pin is the only
thing that distinguishes them.

### What this blocks

`@al-ft/midgard-sdk` is **not vendored here and is not a dependency**. The
authoritative datum schemas (`StateQueueNodeSchema`, `HeaderSchema`,
`DepositDatum`, `WithdrawalOrderDatum`, `TxOrderDatum`) live in that package,
not in Core. Core exports the transaction, address, value and CBOR codecs, which
`src/decode/transaction.ts` already uses correctly.

So replacing the hand-rolled datum decoders with authoritative schemas requires
vendoring the SDK, which requires Lucid `0.6.0`, which requires the vendored
Core to be rebuilt against `0.6.0` as well. That is upstream work and an
explicit decision, not a refactor to start unprompted.

`src/decode/datum.ts` imports `Data` from `@lucid-evolution/lucid`, so Lucid
moved from `devDependencies` to `dependencies` in `backend/package.json` on
2026-08-08. A `src/` module importing a devDependency compiles locally and
breaks a production install. The version is unchanged at `0.4.31`, which must
stay in step with the vendored Core above.

## Codec migration spike, 2026-08-08

Question: can the authoritative datum schemas replace the hand-rolled decoders
without a Lucid upgrade?

Method: declared the SDK's `DepositDatumSchema` shape (`Data.Object` over
`OutputReferenceSchema`, `AddressSchema`, `POSIXTimeSchema`, 28 byte witness)
using **this backend's Lucid 0.4.31**, then decoded a real preprod deposit
datum fetched from Koios with `_bytecode: true`
(tx `99c19fd1dde216d6a9462a8968d582e5ed4b3ec72ea24c5f026c1eec00f18a9c`,
output 1, 348 hex characters).

Result: **it decodes**, into named fields matching what the hand-rolled decoder
produces (`transactionId`, `outputIndex`, `paymentCredential`, `l2_network_id`).

What that establishes:

1. A Lucid major upgrade is **not** required to decode Midgard datums
   declaratively. The blocker is packaging, not the CBOR or the Data API.
2. `@al-ft/midgard-sdk` still cannot be imported here: it requires Lucid
   `0.6.0` and the vendored Core is built against `0.4.31`.
3. One difference to handle if the migration proceeds: 0.4.31 renders a
   `Data.Nullable(Data.Enum([...]))` as `{ wrapper: {...} }` rather than the
   bare value.

Recommendation: **do not** declare a local copy of the SDK's schemas. That is a
second source of protocol truth with no drift detection, which is the problem
the migration exists to solve, not a fix for it. The cheap upstream fix is to
publish `@al-ft/midgard-core` and `@al-ft/midgard-sdk` from one Midgard commit
with one Lucid version, after which the SDK can be vendored here the same way
Core is and the decoders become imports.

Until then the hand-rolled decoders stay, pinned by tests built from the Aiken
types rather than from the decoder.
