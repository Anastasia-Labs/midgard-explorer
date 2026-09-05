import { describe, expect, it } from "vitest";
import { classifyStatement } from "../bench/attribution.mjs";

/**
 * The classifier, against query texts captured from a real request.
 *
 * These are the actual statements a single `block-detail` request issued,
 * shortened but not reworded. A classifier tested on invented strings would
 * agree with itself and tell us nothing about the baseline it explains.
 */
describe("classifyStatement", () => {
  it("names transaction control, whatever its form", () => {
    for (const query of [
      "BEGIN",
      "COMMIT",
      "ROLLBACK",
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      "  begin  ",
    ]) {
      expect(classifyStatement(query), query).toBe("transaction-control");
    }
  });

  it("names the explorer's own bookkeeping", () => {
    for (const query of [
      'SELECT "public"."sync_cursor"."source", "public"."sync_cursor"."last_block_height" FROM "public"."sync_cursor"',
      'SELECT "public"."index_binding"."id", "public"."index_binding"."deployment_id" FROM "public"."index_binding"',
    ]) {
      expect(classifyStatement(query), query).toBe("metadata");
    }
  });

  it("names everything the route asked for on the response's behalf", () => {
    for (const query of [
      "SELECT member_id, ordinal, source_time_stamp_tz FROM pending_block_finalization_deposits WHERE header_hash = $1",
      "WITH legacy AS ( SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash ), ordered AS (",
      'SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."l1_event"."id" FROM "public"."l1_event") t',
      'SELECT "public"."l1_block_header"."header_hash" FROM "public"."l1_block_header"',
    ]) {
      expect(classifyStatement(query), query).toBe("route-query");
    }
  });

  it("does not mistake a route query that merely mentions a keyword", () => {
    // `blocks` contains no metadata table name, and a SELECT is not control
    // flow just because the word "transaction" appears in a column.
    expect(
      classifyStatement("SELECT l2_transaction_count FROM da_payloads WHERE header_hash = $1"),
    ).toBe("route-query");
  });
});
