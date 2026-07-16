import { Component, type ErrorInfo, type ReactNode } from "react";
import GlassCard from "./GlassCard";
import PageShell from "./PageShell";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// Catches render-time errors anywhere below it so a single bad payload doesn't
// blank the whole app.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <PageShell>
        <GlassCard className="mx-auto mt-24 max-w-md p-8 text-center">
          <p className="text-2xl font-semibold text-slate-100">
            Something went wrong
          </p>
          <p className="mt-3 text-slate-400">
            The explorer hit an unexpected error rendering this page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-block rounded-lg bg-slate-100/10 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-100/20"
          >
            Reload
          </button>
        </GlassCard>
      </PageShell>
    );
  }
}
