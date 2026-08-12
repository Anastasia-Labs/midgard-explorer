import type { TransactionView } from "@midgard-explorer/contracts";
import { Card } from "../../../components/ui/primitives";
import {
  CapabilityRow,
  EvidenceHash,
  EvidenceList,
  } from "./shared";

/** Everything a reader needs that is not the ledger movement: credentials,
 * commitments, capabilities and the Cardano-only sections Midgard's native
 * transaction v1 rejects.
 *
 * Extracted from the route with its own helpers, which is the whole point of
 * the split: these components are used by this tab and by nothing else, so a
 * reader of the route no longer has to scroll past them. */
export function DetailsTab({ tx }: { tx: TransactionView }) {
  const detailsTab = (
    <div className="space-y-4">
      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold text-text">Authorization and commitments</h2>
          <p className="mt-0.5 mg-caption text-text-3">
            Identities required by the native body and hashes that bind script or auxiliary data.
          </p>
        </div>
        <dl className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2">
          <EvidenceList
            label="Required signers"
            kind="requiredSigner"
            values={tx.requiredSigners}
            empty="No additional signer hashes declared"
          />
          <EvidenceList
            label="Required observers"
            kind="requiredObserver"
            values={tx.requiredObservers}
            empty="No withdrawal observer scripts declared"
          />
          <EvidenceHash
            label="Script integrity hash"
            kind="script"
            value={tx.scriptIntegrityHash}
          />
          <EvidenceHash label="Auxiliary-data hash" kind="metadata" value={tx.auxiliaryDataHash} />
        </dl>
      </Card>

      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-semibold text-text">Protocol availability</h2>
          <p className="mt-0.5 mg-caption text-text-3">
            Accounted for explicitly from the Midgard native format and node indexes.
          </p>
        </div>
        <dl className="divide-y divide-border">
          <CapabilityRow
            label="Collateral and return"
            kind="collateral"
            capability={tx.capabilities.collateral}
          />
          <CapabilityRow
            label="Metadata and CIP-20"
            kind="metadata"
            capability={tx.capabilities.metadata}
          />
          <CapabilityRow
            label="Certificates"
            kind="certificate"
            capability={tx.capabilities.certificates}
          />
          <CapabilityRow
            label="Withdrawals"
            kind="withdrawal"
            capability={tx.capabilities.withdrawals}
          />
          <CapabilityRow
            label="Governance operations"
            kind="governance"
            capability={tx.capabilities.governance}
          />
          <CapabilityRow
            label="Protocol events / logs"
            kind="protocolEvent"
            capability={tx.capabilities.protocolEvents}
          />
          <CapabilityRow
            label="Execution trace"
            kind="executionTrace"
            capability={tx.capabilities.executionTrace}
          />
          <CapabilityRow
            label="Consumed-by index"
            kind="consumedBy"
            capability={tx.capabilities.consumedBy}
          />
        </dl>
      </Card>
    </div>
  );

  return detailsTab;
}
