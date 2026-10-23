import { redirect } from "next/navigation";

/** Legacy path form /transactions/2. Canonical pagination is the query param,
 * so this redirects rather than duplicating the list route. */
export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  redirect(/^[0-9]{1,6}$/.test(page) ? `/transactions?page=${page}` : "/transactions");
}
