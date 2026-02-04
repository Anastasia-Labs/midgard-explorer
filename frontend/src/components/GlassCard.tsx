import type { HTMLAttributes, ReactNode } from "react";

export default function GlassCard({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`glass-panel shine ${className}`} {...props}>
      {children}
    </div>
  );
}
