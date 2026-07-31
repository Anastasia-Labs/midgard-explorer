import Link from "next/link";
import type { BlockFinalization, TxInclusion } from "@midgard-explorer/contracts";
import { Icon } from "./icons";
import { StatusBadge } from "./status";
import { Timestamp } from "./timestamp";

/** Execution, inclusion and settlement are three separate questions about a
 * transaction, and a single status badge can only answer the first. This band
 * answers the other two side by side, and says plainly when it cannot. */
export function SettlementBand({
  inclusion,
  finalization,
}: {
  inclusion: TxInclusion | null;
  finalization: BlockFinalization | null;
}) {
  return (
    <div className="mb-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
      <div className="bg-surface px-4 py-3.5">
        <p className="mg-overline">L2 inclusion</p>
        {inclusion === null ? (
          <>
            <p className="mt-1 text-[15px] text-text-2">Not in a block yet</p>
            <p className="mt-1 text-[12.5px] text-text-3">
              The transaction has not been committed to an L2 block.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 flex items-center gap-2 text-[15px]">
              <Link
                href={`/block/${inclusion.header_hash}`}
                className="font-display font-semibold text-accent hover:underline"
              >
                Block #{inclusion.height}
              </Link>
              <Icon name="arrowRight" size={13} className="text-text-3" />
            </p>
            <p className="mt-1 text-[12.5px] text-text-3">
              <Timestamp iso={inclusion.time_stamp_tz} />
            </p>
          </>
        )}
      </div>

      <div className="bg-surface px-4 py-3.5">
        <p className="mg-overline">Cardano L1 settlement</p>
        {inclusion === null ? (
          <>
            <p className="mt-1 text-[15px] text-text-2">Not applicable yet</p>
            <p className="mt-1 text-[12.5px] text-text-3">
              Settlement follows inclusion: a block has to carry the transaction first.
            </p>
          </>
        ) : finalization === null ? (
          <>
            <p className="mt-1 text-[15px] text-text-2">Not yet recorded</p>
            <p className="mt-1 text-[12.5px] text-text-3">
              The node has no finalization record for this block yet.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1">
              <StatusBadge status={finalization.status} />
            </p>
            <p className="mt-1.5 text-[12.5px] text-text-3">
              {finalization.status === "finalized"
                ? "Settled on Cardano L1. This transaction is no longer reversible."
                : "Reversible until the block is final on Cardano L1."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
