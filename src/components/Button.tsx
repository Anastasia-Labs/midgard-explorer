import type { ButtonHTMLAttributes, ReactNode } from "react";

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-50";

const variants = {
  primary:
    "bg-gradient-to-r from-cyan-400/90 via-sky-400/90 to-indigo-400/90 text-slate-950 shadow-[0_10px_30px_rgba(56,189,248,0.35)] hover:brightness-110",
  ghost:
    "bg-white/5 text-slate-100 ring-1 ring-white/10 hover:bg-white/10",
} as const;

type Variant = keyof typeof variants;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export default function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={`${baseClasses} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
