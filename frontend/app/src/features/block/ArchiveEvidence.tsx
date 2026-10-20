import type { BlockEvidence } from "@midgard-explorer/contracts";
import { FactGroup, FactRow } from "../../components/ui/base/facts";
import { ToneBadge } from "../../components/ui/domain/status";
import { EVIDENCE_ORDER, evidenceCopy, observationLabel } from "../../lib/evidence";

/**
 * What is known about an archived block, one fact per line.
 *
 * The checks this explorer ran say Verified; the facts it cannot observe say
 * Unknown and why. Each line stands alone: a verified payload says nothing
 * about Cardano, and an unknown merge is not a "no".
 */
export function ArchiveEvidence({ evidence }: { evidence: BlockEvidence }) {
  return (
    <FactGroup title="What is known">
      {EVIDENCE_ORDER.map((key) => {
        const line = evidence[key];
        const copy = evidenceCopy(key, line);
        return (
          <FactRow key={key} label={copy.label}>
            {/* The badge alone; why it reads so is in its info tip. */}
            <ToneBadge tone={copy.tone} label={copy.value} explain={copy.detail} />
            {line.observation ? (
              <span className="mt-1 block mg-caption text-text-3">
                {observationLabel(line.observation)}
              </span>
            ) : null}
          </FactRow>
        );
      })}
    </FactGroup>
  );
}
