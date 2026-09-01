import Link from "next/link";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-page-copy">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {item.href ? (
              <Link
                href={item.href}
                className="inline-flex min-h-9 items-center hover:text-link-hover sm:min-h-0"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-link">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
