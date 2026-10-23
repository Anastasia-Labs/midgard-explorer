import { notFound } from "next/navigation";

export function parsePage(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (!/^[0-9]{1,6}$/.test(raw)) notFound();
  const page = Number(raw);
  if (page < 1) notFound();
  return page;
}
