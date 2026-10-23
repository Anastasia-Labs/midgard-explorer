/// <reference path="../src/types/midgard-untyped.d.ts" />
import { readFileSync } from "node:fs";
import type { PayloadSource } from "./ingestBlock";

/** One served payload: the header it answers for and the envelope, as hex. */
export type FixtureBlock = { headerHash: string; prevHeaderHash?: string; identity: string };

/**
 * A payload source that serves recorded envelopes instead of dialing a peer,
 * for local runs over fixture data. It answers only for the headers it holds,
 * and every copy still goes through Midgard's header verifier. Its source id
 * names the fixture, so nothing it archives can pass for a live fetch.
 */
export function fixturePayloadSource(blocks: readonly FixtureBlock[], label: string): PayloadSource {
  const sourceId = `fixture:${label}`;
  const byHeader = new Map(blocks.map((b) => [b.headerHash, b.identity]));
  return {
    sourceId,
    async fetchPayloadByHeaderHash(headerHash, options) {
      const hex = byHeader.get(headerHash);
      if (hex === undefined) {
        return {
          ok: false,
          sourceId,
          attempts: [{ sourceId, sourcePeerId: "fixture", protocol: "payload-by-header", status: "not_found", detail: "not in the fixture" }],
        };
      }
      const { admitEvidenceProvenance, assertSecurityGradeEvidence } = await import("@al-ft/midgard-sdk");
      const payloadEnvelopeCbor = Buffer.from(hex, "hex");
      await options?.verifyPayload?.(payloadEnvelopeCbor);
      return {
        ok: true,
        sourceId,
        sourcePeerId: "fixture",
        payloadEnvelopeCbor,
        metadata: {},
        attempts: [],
        provenance: assertSecurityGradeEvidence(
          admitEvidenceProvenance({
            provenance: { trustClass: "public_or_permissionless_da", sourceId: `${sourceId}/fixture`, grade: "security" },
          }),
        ),
      };
    },
  } as PayloadSource;
}

/** Every block in a fixture file written as `da-payloads-*.json` is. */
export function readFixtureFile(path: string): FixtureBlock[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const blocks: FixtureBlock[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value !== null && typeof value === "object") {
      const row = value as Partial<FixtureBlock>;
      if (typeof row.headerHash === "string" && typeof row.identity === "string") {
        blocks.push({ headerHash: row.headerHash, identity: row.identity, prevHeaderHash: row.prevHeaderHash });
      }
    }
  };
  for (const [key, value] of Object.entries(parsed)) if (!key.startsWith("_")) visit(value);
  return blocks;
}
