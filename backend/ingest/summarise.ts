/** Serving budgets: one page is one bounded read. */
export const DEFAULT_BUDGET = { records: 50, bytes: 1_000_000, detailBytes: 4_000_000 };
export type Budget = typeof DEFAULT_BUDGET;

/** The kinds of record a block payload carries, as `block_body` names them. */
export const RECORD_KINDS = ["transactions", "deposits", "withdrawals", "forced_transactions"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

type PageRecord = {
  index: number;
  key: string;
  valueBytes: number;
  /** The value itself, when the record fits a page. */
  value?: string;
  /** Where the value is, when it does not fit a page but fits a detail object. */
  detailKey?: string;
  /** Where the raw bytes are, when the value fits neither. */
  raw?: { payloadKey: string; kind: RecordKind; index: number };
};

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/**
 * Cuts one kind of record into pages of at most `budget.records` records and
 * `budget.bytes` bytes. A record that would not fit a page on its own goes to
 * a detail object under `budget.detailBytes`; beyond that, the page keeps its
 * summary and a link into the archived raw payload.
 */
export function summarise(args: {
  fingerprint: string;
  /** `<headerHash>-<payloadSha256>-<schema>` */
  block: string;
  payloadKey: string;
  kind: RecordKind;
  entries: ReadonlyArray<readonly [string, string]>;
  budget?: Budget;
}): {
  pages: Record<string, Uint8Array>;
  details: Record<string, Uint8Array>;
  count: { records: number; pages: number };
  /** The page each record is on, by record index. */
  pageOf: number[];
} {
  const budget = args.budget ?? DEFAULT_BUDGET;
  const base = `${args.fingerprint}/blocks/${args.block}`;
  const pages: Record<string, Uint8Array> = {};
  const details: Record<string, Uint8Array> = {};
  const encodePage = (records: PageRecord[]) => encode({ kind: args.kind, records });

  const records: PageRecord[] = args.entries.map(([key, value], index) => {
    const full: PageRecord = { index, key, valueBytes: value.length / 2, value };
    if (encodePage([full]).length <= budget.bytes) return full;
    const detail = encode({ kind: args.kind, index, key, value });
    if (detail.length <= budget.detailBytes) {
      const detailKey = `${base}/detail/${args.kind}-${index}.json`;
      details[detailKey] = detail;
      return { index, key, valueBytes: full.valueBytes, detailKey };
    }
    return { index, key, valueBytes: full.valueBytes, raw: { payloadKey: args.payloadKey, kind: args.kind, index } };
  });

  const pageOf: number[] = [];
  let current: PageRecord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    pages[`${base}/${args.kind}/${Object.keys(pages).length}.json`] = encodePage(current);
    current = [];
  };
  for (const record of records) {
    if (current.length >= budget.records || encodePage([...current, record]).length > budget.bytes) flush();
    current.push(record);
    pageOf[record.index] = Object.keys(pages).length;
  }
  flush();
  return { pages, details, count: { records: records.length, pages: Object.keys(pages).length }, pageOf };
}
