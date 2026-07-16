import { Link } from "react-router-dom";
import GlassCard from "../components/GlassCard";
import PageShell from "../components/PageShell";

export default function NotFoundPage() {
  return (
    <PageShell>
      <GlassCard className="mx-auto mt-24 max-w-md p-8 text-center">
        <p className="text-5xl font-semibold text-slate-100">404</p>
        <p className="mt-3 text-slate-400">
          This page doesn’t exist on the explorer.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg bg-slate-100/10 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-100/20"
        >
          Back to home
        </Link>
      </GlassCard>
    </PageShell>
  );
}
