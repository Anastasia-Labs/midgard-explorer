import { api } from "../../lib/api";
import type { DeploymentContext } from "@midgard-explorer/contracts";

/**
 * Says which Midgard deployment the figures describe and which database they
 * came from, and warns loudly when that database is a test fixture.
 *
 * This exists because of a real failure, not a hypothetical one: the explorer
 * read a phase-4 test database for weeks and presented it as the live chain.
 * The cause was one line in a gitignored .env, so it appeared in no diff and
 * survived every review. The boot log now names the database, which protects
 * an operator. This is the same fact where a viewer can see it.
 *
 * Rendered in the shell rather than on one page, so no page can show fixture
 * figures without the warning attached.
 *
 * It reads `/api/source`, which is the Midgard node's own answer. It used to
 * read the Cardano index's summary, so a banner about the MIDGARD source
 * depended on a second database: when that database was stopped, every page
 * announced "the backend could not be reached" while the backend was serving
 * Midgard data perfectly. A banner about a source must not fail for a reason
 * outside that source.
 */
async function readSource(): Promise<{ source: DeploymentContext | null; reached: boolean }> {
  try {
    return { source: await api.source(), reached: true };
  } catch {
    return { source: null, reached: false };
  }
}

export async function SourceBanner() {
  const { source, reached } = await readSource();

  // Failing open is the one thing this component must not do. If the source
  // cannot be read, the pages below still render whatever figures they can
  // reach, and staying silent would let fixture data through under exactly the
  // conditions that hid it for weeks. So an unconfirmed source says so.
  if (source === null || source.identityState === "unconfigured") {
    return (
      <div
        role="status"
        className="border-b border-warning/45 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning"
      >
        <strong className="font-semibold">Data source unconfirmed.</strong>{" "}
        {reached
          ? "The backend could not say which Midgard deployment it is reading."
          : "The backend could not be reached to confirm which database it is reading."}{" "}
        Treat any figures below as unverified.
      </div>
    );
  }

  if (source.sourceKind === "fixture") {
    return (
      <div
        role="status"
        className="border-b border-warning/45 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning"
      >
        <strong className="font-semibold">Test fixture, not live data.</strong> Midgard figures on
        this site come from the database <code className="font-mono">{source.database}</code>, which
        is not the live node.
      </div>
    );
  }

  // Real data that is allowed to be stale. Said plainly, with the capture time,
  // because "how old" is the only question a snapshot raises.
  if (source.sourceKind === "snapshot") {
    const capturedAt = source.freshness.observedAsOf;
    return (
      <div
        role="status"
        className="border-b border-border bg-surface-2 px-4 py-2 text-center text-sm text-text-2"
      >
        <strong className="font-semibold text-text">Snapshot, not the live node.</strong> Real
        Midgard data from <code className="font-mono">{source.database}</code>
        {capturedAt === null ? "" : `, captured ${capturedAt}`}. Nothing here advances.
      </div>
    );
  }

  return null;
}

/**
 * The deployment identity, for pages that describe a single deployment.
 *
 * `configured`, never "verified". Everything here comes from the manifest this
 * process reads: it says which deployment an operator INTENDED, and nothing
 * checks that claim against Cardano. Multiple manifests are deliberately not
 * supported: the explorer serves the deployment it is configured for, and says
 * which one that is.
 */
export async function DeploymentNote() {
  const { source } = await readSource();
  if (source === null || source.deploymentId === null) return null;

  return (
    <p className="text-sm text-text-3">
      Deployment <code className="font-mono text-text-2">{source.deploymentId.slice(0, 12)}</code>{" "}
      on {source.network}, as configured. Reading Midgard from{" "}
      <code className="font-mono text-text-2">{source.database}</code>.
    </p>
  );
}
