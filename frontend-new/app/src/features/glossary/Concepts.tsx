import { Icon, type IconName } from "../../components/ui/icons";
import { cn } from "../../lib/format";

/** The three Midgard-specific concepts, as an orientation before the index.
 *
 * These lived on the overview until the overview was streamlined. They are not
 * duplicated by the glossary index below them: that defines terms one at a time
 * ("what does `pending_commit` mean"), while these describe the shape of the
 * protocol a reader needs before any single term is meaningful. Nothing else in
 * the app says a Midgard block is not final until Cardano confirms it.
 */
const CONCEPTS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "activity",
    title: "Transaction lifecycle",
    body: "A transaction moves from queued through validating and accepted, waits as pending commit, then becomes committed once a Midgard block includes it. Rejected transactions stop and keep their reason.",
  },
  {
    icon: "layers",
    title: "Block finalization",
    body: "The operator commits Midgard blocks, then submits a finalization transaction to Cardano. A block is finalized only after that Cardano transaction is confirmed and stable.",
  },
  {
    icon: "bridge",
    title: "L1 ↔ L2 bridge",
    body: "Deposits move value onto the Midgard ledger, withdrawals move it back to Cardano, and forced transactions are orders escrowed on Cardano that the operator must include.",
  },
];

export function Concepts() {
  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-border bg-surface shadow-(--mg-shadow)">
      <h2 className="px-4 py-3 text-body font-semibold text-text">
        How the Midgard ledger works
        <span className="ml-2 font-sans mg-caption font-normal text-text-3">
          What this explorer tracks, and where each record comes from
        </span>
      </h2>
      <div className="grid border-t border-border sm:grid-cols-3">
        {CONCEPTS.map((c, i) => (
          <div
            key={c.title}
            className={cn(
              "px-4 py-4",
              i < CONCEPTS.length - 1 && "border-b border-border sm:border-b-0 sm:border-r",
            )}
          >
            <span className="flex items-center gap-2 text-info">
              <Icon name={c.icon} size={15} />
              <span className="text-sm font-semibold text-text">{c.title}</span>
            </span>
            <p className="mt-2 mg-caption leading-relaxed text-text-2">{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
