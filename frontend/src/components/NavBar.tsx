import { Link } from "react-router-dom";
import SearchBar from "./SearchBar";
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
        <SearchBar />
      </div>
      <nav className="hidden items-center gap-3 text-sm text-slate-300 sm:flex">
        <Link
          to="/blocks/1"
          className="rounded-full px-3 py-2 hover:bg-white/5"
        >
          Blocks
        </Link>
        <Link
          to="/transactions/1"
          className="rounded-full px-3 py-2 hover:bg-white/5"
        >
          Transactions
        </Link>
      </nav>
    </header>
  );
}
