import { api } from "../../lib/api";

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
 */
export async function SourceBanner() {
  let source;
  let confirmed = true;
  try {
    source = (await api.l1Summary()).source ?? null;
  } catch {
    source = null;
    confirmed = false;
  }

  // Failing open is the one thing this component must not do. If the source
  // cannot be read, the pages below still render whatever figures they can
  // reach, and staying silent would let fixture data through under exactly the
  // conditions that hid it for weeks. So an unconfirmed source says so.
  if (!source) {
    return (
      <div
        role="status"
        className="border-b border-warning/45 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning"
      >
        <strong className="font-semibold">Data source unconfirmed.</strong>{" "}
        {confirmed
          ? "The backend did not report which database it is reading."
          : "The backend could not be reached to confirm which database it is reading."}{" "}
        Treat any figures below as unverified.
      </div>
    );
  }

  if (source.isFixture) {
    return (
      <div
        role="status"
        className="border-b border-warning/45 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning"
      >
        <strong className="font-semibold">Test fixture, not live data.</strong> Midgard L2 figures
        on this site come from the database <code className="font-mono">{source.l2Database}</code>,
        which is not the live node.
      </div>
    );
  }

  return null;
}

/** The deployment identity, for pages that describe a single deployment.
 * Multiple manifests are deliberately not supported: the explorer indexes the
 * deployment it is configured for, and says which one that is. */
export async function DeploymentNote() {
  let source;
  try {
    source = (await api.l1Summary()).source;
  } catch {
    return null;
  }
  if (!source?.deployment) return null;

  return (
    <p className="text-sm text-text-3">
      Deployment <code className="font-mono text-text-2">{source.deployment.slice(0, 12)}</code> on{" "}
      {source.network}, deployed {new Date(source.deployedAt).toISOString().slice(0, 10)}. Reading
      L2 from <code className="font-mono text-text-2">{source.l2Database}</code>.
    </p>
  );
}
