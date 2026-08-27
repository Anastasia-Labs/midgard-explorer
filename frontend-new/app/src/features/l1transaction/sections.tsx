import type { L1MidgardAction, L1TransactionResponse } from "../../lib/api";
import { AdaAmount } from "../../components/ui/amount";
import { Identifier } from "../../components/ui/identifier";
import { Card } from "../../components/ui/primitives";
import { Timestamp } from "../../components/ui/timestamp";
import { contractName } from "../../components/ui/validatorlabel";

/** A skipped operator can leave a user event unprocessed. The decoder proves
 * which kind, and dropping that on the floor would lose the only part of a
 * skip a user is directly affected by. */
function neglectedText(action: L1MidgardAction): string {
  switch (action.neglected) {
    case "deposit":
      return " A deposit was left unprocessed.";
    case "withdrawal":
      return " A withdrawal was left unprocessed.";
    case "txOrder":
      return " A transaction order was left unprocessed.";
    default:
      return "";
  }
}

function actionText(action: L1MidgardAction): string {
  switch (action.kind) {
    case "deposit":
      return "Deposited funds into Midgard.";
    case "withdrawal":
      return "Recorded a withdrawal from Midgard to Cardano.";
    case "block_commitment":
      return "Committed a Midgard header to Cardano.";
    case "scheduler_shift":
      switch (action.operation) {
        case "appointFirstOperator":
          return "The Midgard Scheduler appointed its first operator.";
        case "advanceEndOfShift":
          return "The Midgard Scheduler advanced after a shift ended.";
        case "rewindEndOfShift":
          return "The Midgard Scheduler rewound after a shift ended.";
        case "advanceSkippedOperator":
          return `The Midgard Scheduler advanced past a skipped operator.${neglectedText(action)}`;
        case "rewindSkippedOperator":
          return `The Midgard Scheduler rewound after a skipped operator.${neglectedText(action)}`;
        case "advanceOperatorRemoval":
          return "The Midgard Scheduler advanced after an operator was removed.";
        case "rewindOperatorRemoval":
          return "The Midgard Scheduler rewound after an operator was removed.";
        default:
          return "The Midgard Scheduler changed the active operator shift.";
      }
    case "validator_execution":
      return `${contractName(action.family)} validator ran.`;
  }
}

/** The verdict, on every kind of action rather than only on a bare validator
 * run. A deposit whose script failed used to read exactly like one that
 * succeeded, because the row that carried it reported success without anything
 * having checked. */
function Verdict({ action }: { action: L1MidgardAction }) {
  if (action.validContract !== false) return null;
  return (
    <span className="shrink-0 rounded-full border border-danger/50 bg-danger/15 px-2 py-0.5 text-micro font-semibold text-danger">
      Script validation failed
    </span>
  );
}

/** What the event's datum names. A deposit says where on Midgard the funds are
 * destined; a withdrawal says who owns the UTxO leaving. Both are credential
 * hashes rather than addresses, so neither is rendered as a link: the datum
 * does not carry an address and the explorer must not assemble one. */
function UserEvent({ event }: { event: NonNullable<L1MidgardAction["userEvent"]> }) {
  return (
    <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 mg-caption text-text-3">
      {event.kind === "deposit" ? (
        <>
          <div className="min-w-0">
            <dt className="mg-overline">Midgard payment credential</dt>
            <dd className="mt-0.5">
              <Identifier value={event.l2PaymentCredential} head={10} tail={8} />
            </dd>
          </div>
          {event.l2StakeCredential === null ? null : (
            <div className="min-w-0">
              <dt className="mg-overline">Midgard stake credential</dt>
              <dd className="mt-0.5">
                <Identifier value={event.l2StakeCredential} head={10} tail={8} />
              </dd>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="min-w-0">
            <dt className="mg-overline">Owner</dt>
            <dd className="mt-0.5">
              <Identifier value={event.l2Owner} head={10} tail={8} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="mg-overline">Midgard UTxO</dt>
            <dd className="mt-0.5">
              <Identifier
                value={`${event.l2OutRef.txHash}#${event.l2OutRef.index}`}
                href={`/transaction/${event.l2OutRef.txHash}`}
                head={10}
                tail={8}
              />
            </dd>
          </div>
        </>
      )}
      <div className="min-w-0">
        <dt className="mg-overline">Inclusion time</dt>
        <dd className="mt-0.5">
          <Timestamp iso={new Date(Number(event.inclusionTime)).toISOString()} />
        </dd>
      </div>
    </dl>
  );
}

function Action({ action }: { action: L1MidgardAction }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-text">{actionText(action)}</span>
          <Verdict action={action} />
        </span>
        {action.kind === "deposit" && action.lovelace !== null ? (
          <AdaAmount lovelace={action.lovelace} />
        ) : action.kind === "block_commitment" && action.headerHash !== null ? (
          <Identifier value={action.headerHash} href={`/block/${action.headerHash}`} />
        ) : action.kind === "scheduler_shift" && action.operator !== null ? (
          /* The datum's whole payload is who is on shift and since when. It was
             decoded and then dropped, which is the same defect the audit found
             elsewhere: indexed, and not shown. */
          <span className="flex flex-wrap items-center gap-2 mg-caption text-text-3">
            <span>Now on shift</span>
            <Identifier value={action.operator} head={8} tail={6} />
            {action.startTime === null ? null : (
              <Timestamp iso={new Date(Number(action.startTime)).toISOString()} />
            )}
          </span>
        ) : null}
      </div>
      {action.userEvent ? <UserEvent event={action.userEvent} /> : null}
    </li>
  );
}

/** The public L1 view answers only why this Cardano transaction matters to
 * Midgard. Cardano-wide ledger inspection is delegated to CExplorer. */
export function MidgardActions({ tx }: { tx: L1TransactionResponse }) {
  return (
    <Card>
      <h2 className="border-b border-border px-4 py-3 text-body font-semibold text-text">
        Midgard activity
      </h2>
      {tx.actions.length === 0 ? (
        <p className="px-4 py-3 text-body text-text-2">
          This Cardano transaction interacted with a Midgard contract.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {tx.actions.map((action, index) => (
            <Action
              key={`${action.kind}-${action.family}-${action.outputIndex ?? index}`}
              action={action}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}
