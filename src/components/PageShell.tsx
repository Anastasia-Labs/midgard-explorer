import type { ReactNode } from "react";
import BackgroundOrbs from "./BackgroundOrbs";
import NavBar from "./NavBar";

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <BackgroundOrbs />
      <div className="relative z-10">
        <NavBar />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
