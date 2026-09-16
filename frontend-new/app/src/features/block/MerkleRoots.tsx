import type { BlockCommitments, RootPair } from "@midgard-explorer/contracts";
import { Callout } from "../../components/ui/base/layout";
import { Identifier } from "../../components/ui/domain/identifier";

/**
 * The twelve roots of the node's finalization record, each beside the root the
 * previous header recorded.
 *
 * Roots are shown as the node recorded them. The explorer does not recompute
 * them, so nothing here may read as a check of the block's contents: a root is
 * a commitment, and showing one establishes nothing about what it commits to.
 */
export function MerkleRoots({ commitments }: { commitments: BlockCommitments | null }) {
  if (commitments === null) {
    return (
      <div className="p-4">
        <Callout tone="neutral" title="Not reported by the node.">
          The node holds no finalization record for this header, so it reports no roots.
        </Callout>
      </div>
    );
  }
  const roots: ReadonlyArray<readonly [string, RootPair]> = [
    ["UTxOs root", commitments.utxos],
    ["Transactions root", commitments.transactions],
    ["Deposits root", commitments.deposits],
    ["Withdrawals root", commitments.withdrawals],
    ["Forced transactions root", commitments.forced_transactions],
    ["Transition trace root", commitments.transition_trace],
    ["Event-to-step root", commitments.event_to_step],
  ];
  return (
    <>
      <div className="p-4 pb-0">
        <Callout tone="neutral" title="Roots from the node's finalization record.">
          This block&apos;s header commits to each root below. The previous header is the one this
          block builds on. The explorer shows both roots as the node recorded them and does not
          recompute them.
        </Callout>
      </div>
      <ul className="divide-y divide-border">
        {roots.map(([label, pair]) => (
          <li key={label} className="grid gap-2 p-4 sm:grid-cols-[12rem_1fr]">
            <div>
              <p className="text-sm font-semibold text-text">{label}</p>
              <p className="mg-micro text-text-3">{comparison(pair.changed)}</p>
            </div>
            <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="mg-overline">This block</dt>
                <dd className="mt-0.5 text-text">
                  <RootValue root={pair.expected} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="mg-overline">Previous header</dt>
                <dd className="mt-0.5 text-text">
                  <RootValue root={pair.base} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A root is already 64-character hex, so it is shown as it arrives. A missing
 * one is said plainly rather than left blank. */
function RootValue({ root }: { root: string | null }) {
  return root === null ? (
    <span className="text-sm text-text-3">Not reported by the node</span>
  ) : (
    <Identifier value={root} head={6} tail={6} />
  );
}

function comparison(changed: boolean | null): string {
  if (changed === null) return "No previous root to compare";
  return changed ? "Differs from the previous header" : "Same as the previous header";
}
