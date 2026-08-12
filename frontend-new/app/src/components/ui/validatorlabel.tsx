import type { L1ValidatorIdentity } from "../../lib/api";
import { Icon } from "./icons";
import { InfoTip } from "./infotip";

export function contractName(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words.length === 0 ? value : `${words[0]?.toUpperCase()}${words.slice(1)}`;
}

export function validatorFor(
  validators: readonly L1ValidatorIdentity[],
  identity: { family?: string; address?: string; scriptHash?: string },
): L1ValidatorIdentity | null {
  return (
    validators.find(
      (validator) =>
        (identity.family !== undefined && validator.family === identity.family) ||
        (identity.address !== undefined && validator.address === identity.address) ||
        (identity.scriptHash !== undefined && validator.scriptHash === identity.scriptHash),
    ) ?? null
  );
}

export function ValidatorLabel({
  family,
  validators,
}: {
  family: string;
  validators: readonly L1ValidatorIdentity[];
}) {
  const validator = validatorFor(validators, { family });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{contractName(family)}</span>
      {validator ? <ManifestBadge entryName={validator.entryName} /> : null}
    </span>
  );
}

export function ManifestBadge({ entryName }: { entryName: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-success/35 bg-success/10 px-1.5 py-px text-[11px] font-medium text-success">
      <Icon name="shield" size={12} />
      manifest
      <InfoTip
        subject="manifest verification"
        explain={`Verified against ${entryName} in the active deployment manifest.`}
      />
    </span>
  );
}
