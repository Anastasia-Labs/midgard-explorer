import { Link } from "react-router-dom";
export default function NavBar() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-6 sm:px-6">
      <Link to="/" className="group inline-flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/10 shadow-[0_0_20px_rgba(34,211,238,0.35)]">
          <img
            src="/icon-midgard.png"
            alt="Midgard"
            className="h-7 w-7"
          />
        </span>
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">
            Midgard
          </p>
          <p className="text-sm tracking-[0.35em] text-slate-400">
            Explorer
          </p>
        </div>
      </Link>
      <div className="hidden flex-1 items-center justify-center px-6 sm:flex">
        <div className="relative w-full max-w-md">
          <input
            type="search"
            placeholder="Search by block hash or tx hash..."
            className="h-11 w-full rounded-full border border-white/10 bg-white/5 px-5 text-sm text-slate-100 placeholder:text-slate-400 shadow-[inset_0_0_18px_rgba(15,23,42,0.6)] focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs uppercase tracking-[0.22em] text-cyan-200/80">
            Go
          </span>
        </div>
      </div>
      <nav className="hidden items-center gap-3 text-sm text-slate-300 sm:flex">
        <Link
          to="/block/demo"
          className="rounded-full px-3 py-2 hover:bg-white/5"
        >
          Block
        </Link>
        <Link
          to="/transaction/demo"
          className="rounded-full px-3 py-2 hover:bg-white/5"
        >
          Transaction
        </Link>
      </nav>
    </header>
  );
}
