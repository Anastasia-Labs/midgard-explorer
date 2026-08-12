"use client";

import { useSyncExternalStore } from "react";

/** Never notifies: the answer changes exactly once, at hydration, and React
 * re-renders for that transition on its own. */
const neverChanges = () => () => {};
const onTheClient = () => true;
const onTheServer = () => false;

/** True once this component has hydrated, false in the server render.
 *
 * The usual spelling of this is `useState(false)` plus `useEffect(() =>
 * setMounted(true))`, which works but sets state synchronously from an effect
 * and so schedules a second render pass for something React already knows.
 * `useSyncExternalStore` is given a server snapshot and a client snapshot and
 * resolves the difference during hydration instead.
 *
 * Use it to withhold a client-only value that would otherwise race hydration:
 * a query that resolves quickly enough to beat React produces a server/client
 * mismatch, and React responds by discarding the server HTML for that subtree.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(neverChanges, onTheClient, onTheServer);
}
