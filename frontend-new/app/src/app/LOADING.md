# Why there is no `app/loading.tsx`

A `loading.tsx` wraps its segment in a Suspense boundary. At the root, that
boundary covers every route, so Next flushes the shell with `200 OK` before any
page body runs. A `notFound()` reached afterwards renders the not-found page
into an already-committed 200 response, and the status can no longer change.

That is what made `/block/not-a-hash` answer `200` while `/no-such-route`
answered `404`: the second is resolved by the router before rendering, the first
only once the page component runs. A crawler, an uptime check and a link checker
all read the status, so the explorer was reporting every malformed identifier as
a valid page.

The rule that follows:

- **List routes** may have their own `loading.tsx`. They never call
  `notFound()`, so streaming early costs nothing. `/blocks`, `/transactions`,
  `/deposits`, `/withdrawals`, `/forced-transactions` and `/assets` each have
  one.
- **Detail routes** must not. `/block/[headerHash]`, `/transaction/[txHash]`,
  `/address/[address]` and `/asset/[unit]` all validate an identifier and call
  `notFound()`, so their response status has to stay open until they have
  decided. They are `force-dynamic` and render in one pass, so there is no
  skeleton to miss.
- **The root must not**, because a root boundary applies the detail routes'
  problem to everything.

## The overview still gets its skeleton

The overview awaits five endpoints, so it does want a boundary. It gets one
without reintroducing the root problem by living in a **route group**:

    src/app/(overview)/page.tsx
    src/app/(overview)/loading.tsx

A route group adds no URL segment, so the page is still `/`, but the Suspense
boundary is scoped to that group rather than to the root. Detail routes sit
outside it and keep their status open.

This was learned twice. `835a859` added `src/app/loading.tsx` for the overview's
benefit and silently reverted the rule above; the ten status-code assertions in
`e2e/core-flows.spec.ts` failed from that commit until the route group replaced
it. If a boundary is ever wanted for another slow page, give that page its own
group. Never put one at the root.

`e2e/core-flows.spec.ts` asserts the status codes directly, so reintroducing a
root `loading.tsx` fails the suite rather than silently reverting this.
