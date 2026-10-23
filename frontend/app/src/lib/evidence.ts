import type {
  ArchiveState,
  BlockEvidence,
  BlockOutcome,
  DeploymentContext,
  EvidenceLine,
  Observation,
} from "@midgard-explorer/contracts";
import { statusOf, type StatusTone } from "./status-registry";

/**
 * Words for what the explorer's archive knows about a block.
 *
 * Each of the nine lines is a separate question with its own evidence, so
 * each has its own label and its own sentence, and a line no source covers
 * says which observation is missing. Nothing here turns an unknown into a
 * zero, a "no" or a pass.
 */

export type EvidenceKey = keyof BlockEvidence;

/** Whether the backend reads the explorer's archive (the public source). It
 * names its database `archive`, fixture-fed or not. */
export const readsArchive = (source: DeploymentContext | null | undefined): boolean =>
  source?.database === "archive";

/** Why a list served from the archive cannot be filtered by settlement. */
export const ARCHIVE_FILTER_REASON = "Not available for archived data";

export const EVIDENCE_ORDER: readonly EvidenceKey[] = [
  "payloadIntegrity",
  "headerBinding",
  "roots",
  "l1Observation",
  "daStatus",
  "maturity",
  "localApplication",
  "merge",
  "withdrawalPayment",
];

type Copy = { label: string; value: string; detail: string; tone: StatusTone };

const LABEL: Record<EvidenceKey, string> = {
  payloadIntegrity: "Payload integrity",
  headerBinding: "Header binding",
  roots: "Merkle roots",
  l1Observation: "In the state queue",
  daStatus: "Data availability",
  maturity: "Maturity",
  localApplication: "Ledger application",
  merge: "Merge",
  withdrawalPayment: "Withdrawal payouts",
};

/** What a passing check established, line by line. */
const PASSED: Partial<Record<EvidenceKey, string>> = {
  payloadIntegrity: "The payload matches the size and SHA-256 hash its envelope declares.",
  headerBinding: "The header inside the payload hashes to this block's header hash.",
  roots: "The roots rebuilt from the payload match the header.",
};

/** Why a line is unknown or not checked: the typed reason, per line. */
const REASON: Partial<Record<EvidenceKey, Record<string, string>>> = {
  roots: {
    no_authenticated_l1_header_observation:
      "Rebuilding the roots needs this header as Cardano recorded it, and this explorer does not read it.",
  },
  l1Observation: {
    no_queue_observation:
      "This explorer does not read Midgard's state queue on Cardano, so it cannot say whether this header is there.",
  },
  daStatus: {
    no_queue_observation:
      "The committee's attestation is recorded in the state queue, which this explorer does not read.",
  },
  maturity: {
    no_queue_observation:
      "Maturity counts from the header's time in the state queue, which this explorer does not read.",
  },
  localApplication: {
    not_read_by_public_source:
      "This explorer reads its archive and the node's public API, not the node's own records.",
  },
  merge: {
    no_queue_observation:
      "No merge or removal is recorded for this block. Both are state queue events this explorer does not read.",
  },
  withdrawalPayment: {
    no_withdrawals_in_block: "This block carries no withdrawals.",
    no_queue_observation: "Payouts happen on Cardano, which this explorer does not read.",
  },
};

const RECORDED: Record<string, { value: string; tone: StatusTone }> = {
  merged: { value: "Merged", tone: statusOf("merged").tone },
  removed: { value: "Removed", tone: "danger" },
  unresolved: { value: "Outcome unresolved", tone: "warning" },
};

export function evidenceCopy(key: EvidenceKey, line: EvidenceLine): Copy {
  const label = LABEL[key];
  const because =
    (line.reason !== null ? REASON[key]?.[line.reason] : undefined) ??
    "No source this explorer reads covers it.";
  switch (line.state) {
    case "pass":
      return {
        label,
        value: "Verified",
        detail: PASSED[key] ?? "Checked by this explorer.",
        tone: "success",
      };
    case "fail":
      return {
        label,
        value: "Failed",
        detail: "This explorer's check did not pass.",
        tone: "danger",
      };
    case "recorded": {
      const recorded = RECORDED[line.value ?? ""] ?? {
        value: "Recorded",
        tone: "neutral" as const,
      };
      const how =
        line.reason === "ancestry"
          ? "a confirmed header descends from it"
          : line.reason === null
            ? "a recorded outcome"
            : line.reason.replaceAll("_", " ");
      return { label, value: recorded.value, detail: `Recorded from ${how}.`, tone: recorded.tone };
    }
    case "not_run":
      return { label, value: "Not checked", detail: because, tone: "neutral" };
    case "not_applicable":
      return { label, value: "None", detail: because, tone: "neutral" };
    default:
      return { label, value: "Unknown", detail: because, tone: "neutral" };
  }
}

/** Who observed something, said as provenance: an operator's report is
 * that operator's word. */
export function observationLabel(observation: Observation): string {
  const [kind, ...rest] = observation.source.split(":");
  const name = rest.join(":");
  const where = observation.chainPoint === null ? "" : ` at ${observation.chainPoint}`;
  if (kind === "operator") return `Reported by operator ${name}${where}`;
  if (kind === "fixture") return `From the fixture ${name}${where}`;
  return `Observed by ${observation.source}${where}`;
}

/** The headline badge for an archived block. */
export function archiveBadge(outcome: BlockOutcome | null | undefined): {
  label: string;
  tone: StatusTone;
  explain: string;
} {
  if (outcome?.outcome === "removed") {
    return {
      label: "Removed",
      tone: "danger",
      explain: "A recorded outcome says this block was removed from the chain.",
    };
  }
  if (outcome?.outcome === "merged") {
    return {
      label: "Merged",
      tone: statusOf("merged").tone,
      explain: "A recorded outcome says this block was merged into the confirmed state.",
    };
  }
  if (outcome?.outcome === "unresolved") {
    return {
      label: "Outcome unresolved",
      tone: "warning",
      explain: "This block left the state queue, and no source recorded how.",
    };
  }
  return {
    label: "Archived",
    tone: "info",
    explain:
      "Its payload verified against its header. Whether Cardano settled it is not observed here.",
  };
}

/** A header the archive knows of but does not hold. */
export function archiveStateCopy(archive: ArchiveState): {
  title: string;
  detail: string;
  tone: StatusTone;
} {
  if (archive.state === "archiving") {
    return {
      title: "Being archived",
      detail: "Fetching its payload.",
      tone: "info",
    };
  }
  if (archive.state === "failed") {
    return archive.reason === "invalid_payload"
      ? {
          title: "Could not be archived",
          detail: "The payload served did not verify.",
          tone: "warning",
        }
      : {
          title: "Could not be archived",
          detail: "No peer served its payload.",
          tone: "warning",
        };
  }
  if (archive.state === "awaiting") {
    return {
      title: "Waiting to be archived",
      detail: "Its payload has not been fetched yet.",
      tone: "neutral",
    };
  }
  return { title: "Archived", detail: "This block is in the archive.", tone: "info" };
}
