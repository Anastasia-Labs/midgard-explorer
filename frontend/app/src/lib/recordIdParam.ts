/**
 * The `?id=` filter on a bridge list: a record ID, a value to report as
 * ignored, or no filter. A repeated parameter arrives as an array; the first
 * value decides, rather than the values being run together.
 */
export function recordIdParam(raw: string | string[] | undefined): {
  id?: string;
  ignored?: string;
} {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return {};
  return /^[0-9a-f]+$/i.test(value) ? { id: value.toLowerCase() } : { ignored: value };
}
