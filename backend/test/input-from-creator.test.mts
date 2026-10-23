import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeTransaction } from "../src/decode/transaction.js";

/**
 * An input spends an output, and a spent output leaves the ledger, so for any
 * committed transaction the ledger can no longer say what its inputs were.
 * The transaction that created each output still can: its body lists every
 * output it made. The decoder falls back to it for inputs only. A
 * transaction's own outputs are never resolved from its own body, or every
 * output would read as present in the ledger.
 */

type Entry = { label: string; canonicalTxHex: string };
const { entries } = JSON.parse(
  readFileSync(new URL("./fixtures/shape-corpus.json", import.meta.url), "utf8"),
) as { entries: Entry[] };
const tx = (label: string) => Buffer.from(entries.find((e) => e.label === label)!.canonicalTxHex, "hex");

/** The ledger no longer holds anything: every input has been spent. */
const spentLedger = async () => null;

describe("an input whose output has left the ledger", () => {
  /** A creator body in an older codec, or a CML-format genesis output, is
   * not decodable here. That leaves the input unresolved, as it was before the
   * fallback existed; it does not take the whole transaction view with it. */
  it("stays unresolved when the creating body cannot be decoded", async () => {
    const child = await decodeTransaction(tx("multi-input"), spentLedger, {
      creatingTransactions: async (txIds) =>
        new Map(txIds.map((id) => [id, Uint8Array.from([0xff, 0x00, 0x13])])),
    });
    expect(child.inputs.length).toBeGreaterThan(0);
    expect(child.inputs.every((i) => i.resolved === null)).toBe(true);
  });

  it("is resolved from the transaction that created it", async () => {
    const child = await decodeTransaction(tx("multi-input"), spentLedger);
    expect(child.inputs.every((i) => i.resolved === null)).toBe(true);

    const parent = await decodeTransaction(tx("multi-output"));
    const creators = new Map(child.inputs.map((i) => [i.txId, tx("multi-output")]));
    const resolved = await decodeTransaction(tx("multi-input"), spentLedger, {
      creatingTransactions: async (txIds) => new Map(txIds.flatMap((id) => (creators.has(id) ? [[id, creators.get(id)!]] : []))),
    });

    for (const input of resolved.inputs) {
      const made = parent.outputs[input.index]!;
      expect(input.resolved, `${input.txId}#${input.index}`).toMatchObject({
        address: made.address,
        value: made.value,
      });
    }
  });

  it("stays unresolved when no transaction this node holds created it", async () => {
    const resolved = await decodeTransaction(tx("multi-input"), spentLedger, {
      creatingTransactions: async () => new Map(),
    });
    expect(resolved.inputs.every((i) => i.resolved === null)).toBe(true);
  });

  it("never resolves the transaction's own outputs from its own body", async () => {
    const plain = await decodeTransaction(tx("multi-output"), spentLedger);
    const withCreators = await decodeTransaction(tx("multi-output"), spentLedger, {
      creatingTransactions: async (txIds) => new Map(txIds.map((id) => [id, tx("multi-output")])),
    });
    expect(withCreators.outputs.map((o) => o.state)).toEqual(plain.outputs.map((o) => o.state));
  });
});

const REQUIRE_DB = process.env.REQUIRE_DB === "1";
const db = REQUIRE_DB ? describe : describe.skip;

/** Where the route finds a creating transaction: every tier a body can be in,
 * read in one round trip for all of a transaction's inputs. */
db("the bodies of creating transactions", () => {
  it("are read from every tier a transaction can be in, in one call", async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("../prisma/explorer-client/index.js");
    const { getTransactionBodies } = await import("../src/db/transaction.js");
    const { adminUrl, withThrowawayNodeDb } = await import("./helpers/throwawayDb.mjs");
    const id = (b: number) => Buffer.alloc(32, b);
    await withThrowawayNodeDb(async (client) => {
      await client.query("INSERT INTO immutable (tx_id, tx) VALUES ($1, $2)", [id(1), Buffer.from("aa", "hex")]);
      await client.query("INSERT INTO mempool (tx_id, tx) VALUES ($1, $2)", [id(2), Buffer.from("bb", "hex")]);
      const name = (await client.query("SELECT current_database() AS db")).rows[0].db;
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl(name) }) });
      try {
        const found = await getTransactionBodies(
          [id(1), id(2), id(3)].map((b) => b.toString("hex")),
          prisma as unknown as import("../src/db/consistent.js").NodeReader,
        );
        expect([...found.entries()].map(([k, v]) => [k, Buffer.from(v).toString("hex")]).sort()).toEqual([
          [id(1).toString("hex"), "aa"],
          [id(2).toString("hex"), "bb"],
        ]);
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});
