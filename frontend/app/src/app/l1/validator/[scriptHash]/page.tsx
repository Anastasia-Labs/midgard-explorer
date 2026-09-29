import type { Metadata } from "next";
import { isHash28 } from "@midgard-explorer/contracts";
import { notFound } from "next/navigation";
import type { L1ValidatorResponse } from "@midgard-explorer/contracts";
import { Breadcrumbs } from "../../../../components/ui/base/breadcrumbs";
import { IdentityBar } from "../../../../components/ui/domain/identitybar";
import { PageError } from "../../../../components/ui/base/pageerror";
import { Callout, Card } from "../../../../components/ui/base/layout";
import { FactGroup, FactRow } from "../../../../components/ui/base/facts";
import { Identifier } from "../../../../components/ui/domain/identifier";
import { ApiError, api } from "../../../../lib/api";
import { contractName } from "../../../../components/ui/domain/validatorlabel";
import { truncateId } from "../../../../lib/format";
import { L1_EXPLORER_NAME, l1AddressUrl } from "../../../../lib/network";
import { listErrorMessage } from "../../../../lib/serverErrors";
import { viewerInit } from "../../../../lib/viewerInit";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scriptHash: string }>;
}): Promise<Metadata> {
  const { scriptHash } = await params;
  return { title: `Validator ${truncateId(scriptHash)}` };
}

const CRUMBS = [
  { label: "Overview", href: "/" },
  { label: "Cardano", href: "/l1" },
  { label: "Validator" },
];

/**
 * One validator this deployment declares.
 *
 * Everything here comes from the deployment manifest, which is configuration:
 * the family, the purpose, the script hash and the addresses the contract lives
 * at. It is not a history. This page used to list the transactions, UTxOs and
 * script executions the explorer's own chain index had observed at the address;
 * that index is decommissioned, and what happened at the address is a question
 * for a Cardano explorer, which the address link hands over to.
 */
export default async function ValidatorPage({
  params,
}: {
  params: Promise<{ scriptHash: string }>;
}) {
  const { scriptHash } = await params;
  if (!isHash28(scriptHash)) notFound();
  const hash = scriptHash.toLowerCase();

  let data: L1ValidatorResponse;
  try {
    data = await api.validator(hash, await viewerInit());
  } catch (error) {
    // A hash the manifest does not declare is a 404 from the API, and it is
    // this deployment's answer rather than Cardano's: the script may well exist
    // on chain, and nothing here says otherwise.
    if (error instanceof ApiError && error.category === "http_404") notFound();
    return (
      <>
        <Breadcrumbs items={CRUMBS} />
        <IdentityBar title="Validator" overline="Script hash" value={hash} />
        <PageError message={listErrorMessage(error)} />
      </>
    );
  }

  const { validator } = data;
  const addressHref = l1AddressUrl(validator.address);
  const rewardHref =
    validator.rewardAddress === null ? null : l1AddressUrl(validator.rewardAddress);
  const externalName = L1_EXPLORER_NAME ?? "the Cardano explorer";

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Overview", href: "/" },
          { label: "Cardano", href: "/l1" },
          { label: contractName(validator.family) },
        ]}
      />
      <IdentityBar
        title={`${contractName(validator.family)} validator`}
        overline="Validator script hash"
        value={validator.scriptHash}
        summary={[
          {
            label: "Deployment",
            value: <Identifier value={data.deploymentId} head={10} tail={6} />,
          },
          { label: "Network", value: data.network },
        ]}
      />

      {validator.placeholder ? (
        <div className="mb-4">
          <Callout tone="warning" title="A reviewed placeholder, not a deployed validator.">
            The manifest carries this contract so a reader can see it exists and is not implemented.
            Nothing is deployed at the address below.
          </Callout>
        </div>
      ) : null}

      <Card className="mb-4">
        <FactGroup title="Declared by the manifest">
          <FactRow label="Family">{contractName(validator.family)}</FactRow>
          <FactRow label="Purpose">{validator.purpose}</FactRow>
          <FactRow label="Payment address">
            {addressHref === null ? (
              <Identifier value={validator.address} head={12} tail={8} />
            ) : (
              <a
                href={addressHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-text underline decoration-border-strong underline-offset-2 transition-colors hover:text-link hover:decoration-link"
                aria-label={`View ${validator.address} on ${externalName}`}
              >
                {truncateId(validator.address, 12, 8)}
              </a>
            )}
          </FactRow>
          {validator.rewardAddress === null ? null : (
            <FactRow label="Reward address">
              {rewardHref === null ? (
                <Identifier value={validator.rewardAddress} head={12} tail={8} />
              ) : (
                <a
                  href={rewardHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-text underline decoration-border-strong underline-offset-2 transition-colors hover:text-link hover:decoration-link"
                  aria-label={`View ${validator.rewardAddress} on ${externalName}`}
                >
                  {truncateId(validator.rewardAddress, 12, 8)}
                </a>
              )}
            </FactRow>
          )}
          {validator.policyId === null ? null : (
            <FactRow label="Policy id">
              <Identifier value={validator.policyId} />
            </FactRow>
          )}
        </FactGroup>
      </Card>

      <p className="mg-caption text-text-3">
        This explorer does not read Cardano, so it has no history for this address
        {addressHref === null ? "" : `; ${externalName} has it, through the address above`}. What
        the node itself did on Cardano is on{" "}
        <a className="text-link hover:text-link-hover hover:underline" href="/l1">
          Cardano activity
        </a>
        .
      </p>
    </>
  );
}
