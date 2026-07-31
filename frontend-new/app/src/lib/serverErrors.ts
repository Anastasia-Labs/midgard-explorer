import { notFound } from "next/navigation";
import { ApiError } from "./api";

/** 404/400 from the API means the entity does not exist: render the app's
 * not-found page rather than an error page. Anything else propagates. */
export async function orNotFound<A>(p: Promise<A>): Promise<A> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && (e.category === "http_404" || e.category === "http_400")) {
      notFound();
    }
    throw e;
  }
}

export function listErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) throw e;
  if (e.category === "http_404" || e.category === "http_400") notFound();
  return e.safeMessage;
}
