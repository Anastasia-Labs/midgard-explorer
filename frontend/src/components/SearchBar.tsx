import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { isValidAddress } from "../utils";

const isHexOfLength = (value: string, length: number) =>
  value.length === length && /^[0-9a-fA-F]+$/.test(value);

export default function SearchBar() {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setInvalid(true);
      return;
    }

    if (isValidAddress(trimmed)) {
      setInvalid(false);
      navigate(`/address/${trimmed}`);
      return;
    }

    if (isHexOfLength(trimmed, 56)) {
      setInvalid(false);
      navigate(`/block/${trimmed}`);
      return;
    }

    if (isHexOfLength(trimmed, 64)) {
      setInvalid(false);
      navigate(`/transaction/${trimmed}`);
      return;
    }

    setInvalid(true);
  };

  const handleChange = (nextValue: string) => {
    setValue(nextValue);
    if (!invalid) {
      return;
    }
    const trimmed = nextValue.trim();
    if (!trimmed) {
      setInvalid(false);
      return;
    }
    const matches =
      isValidAddress(trimmed) ||
      isHexOfLength(trimmed, 56) ||
      isHexOfLength(trimmed, 64);
    setInvalid(!matches);
  };

  const inputClassName = [
    "h-11 w-full rounded-full border bg-white/5 px-5 pr-16 text-sm text-slate-100 placeholder:text-slate-400 shadow-[inset_0_0_18px_rgba(15,23,42,0.6)] focus:outline-none focus:ring-2",
    invalid
      ? "border-red-400/70 focus:ring-red-400/60"
      : "border-white/10 focus:ring-cyan-300/50",
  ].join(" ");

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-md">
      <input
        type="search"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Search by address, block hash, or tx hash..."
        className={inputClassName}
        aria-invalid={invalid}
      />
      <button
        type="submit"
        className="absolute right-4 top-1/2 -translate-y-1/2 bg-transparent p-0 text-xs uppercase tracking-[0.22em] text-cyan-200/80"
      >
        Go
      </button>
    </form>
  );
}
