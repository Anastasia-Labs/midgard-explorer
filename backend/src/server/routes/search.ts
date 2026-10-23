import { Request, Response } from "express";
import { manifestConfigured } from "../../db/l1";
import { MIN_PREFIX, searchAddress, searchByPrefix } from "../../db/search";

/** Prefix search. Returns an empty result rather than an error for a prefix
 * that is too short, because the caller is a search box being typed into and a
 * 400 on every keystroke below six characters is noise, not information. */
export async function getSearchRoute(req: Request, res: Response) {
  const q = req.query.q;
  if (typeof q !== "string") {
    return res.status(400).json({ error: "Missing q query param." });
  }
  const prefix = q.trim().toLowerCase();
  if (/^(?:addr|stake)(?:_test)?1/.test(prefix)) {
    return res.json({ hits: await searchAddress(prefix), minPrefix: MIN_PREFIX, tooShort: false });
  }
  if (prefix.length < MIN_PREFIX || !/^[0-9a-f]+$/.test(prefix)) {
    return res.json({ hits: [], minPrefix: MIN_PREFIX, tooShort: prefix.length < MIN_PREFIX });
  }
  const hits = await searchByPrefix(prefix);
  // Validators are matched against the manifest. With none configured that
  // lookup is skipped, and the response says so rather than letting an
  // omission read as "no validator matched".
  const unsearched = manifestConfigured() ? {} : { unsearched: ["validator"] };
  return res.json({ hits, minPrefix: MIN_PREFIX, tooShort: false, ...unsearched });
}
