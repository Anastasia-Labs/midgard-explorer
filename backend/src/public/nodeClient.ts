/**
 * The public source's reads from a Midgard node's public HTTP API.
 *
 * Each call is bounded: at most `maxInFlight` at once, a timeout covering the
 * wait and the read, and a byte cap on the body. The node limits reads per
 * client address and answers 429 when that budget is spent, or 503 while it
 * cannot serve a read; every viewer of a deployed explorer shares one address,
 * so both arrive as typed errors carrying the node's Retry-After, never as an
 * empty result.
 */

export type UpstreamReason = "unavailable" | "rate_limited" | "busy" | "too_large" | "invalid";

export class UpstreamError extends Error {
  readonly reason: UpstreamReason;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  constructor(reason: UpstreamReason, message: string, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "UpstreamError";
    this.reason = reason;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** What `GET /tx-status` resolves. `not_found` is the node's own answer. */
export type NodeTxStatus = {
  txId: string;
  status: string;
  reasonCode?: string;
  reasonDetail?: string;
  headerHash?: string;
  timestamps?: { createdAt?: string };
};

export type NodeClientOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxInFlight?: number;
  fetch?: typeof fetch;
  deploymentFingerprint?: string;
};

export class NodeClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxInFlight: number;
  private readonly fetchImpl: typeof fetch;
  private readonly deploymentFingerprint?: string;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(baseUrl: string, options: NodeClientOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxBytes = options.maxBytes ?? 1024 * 1024;
    this.maxInFlight = options.maxInFlight ?? 4;
    this.fetchImpl = options.fetch ?? fetch;
    this.deploymentFingerprint = options.deploymentFingerprint;
  }

  private async slot(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(take);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(new UpstreamError("unavailable", "timed out waiting for a node request slot"));
      };
      const take = () => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          abort();
          this.waiting.shift()?.();
          return;
        }
        // Reserve the slot before waking the caller so a new request cannot
        // jump ahead of a queued one and exceed the concurrency bound.
        this.inFlight += 1;
        resolve(() => {
          this.inFlight -= 1;
          this.waiting.shift()?.();
        });
      };
      if (signal.aborted) return abort();
      if (this.inFlight < this.maxInFlight) return take();
      this.waiting.push(take);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  /** One bounded GET. Resolves to null on a 404, which callers interpret. */
  private async get(path: string): Promise<unknown | null> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    const release = await this.slot(signal);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, { signal, headers: { accept: "application/json" } });
      } catch (cause) {
        const code = (cause as { cause?: { code?: string } })?.cause?.code;
        throw new UpstreamError("unavailable", `the node did not answer: ${String((cause as Error)?.message ?? cause)}${code ? ` (${code})` : ""}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const after = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
      if (!res.ok) await res.body?.cancel();
      if (res.status === 429) throw new UpstreamError("rate_limited", "the node's read budget is spent", 429, after);
      if (res.status === 503) throw new UpstreamError("busy", "the node cannot serve this read now", 503, after);
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) throw new UpstreamError("unavailable", `the node answered ${res.status}`, res.status, after);
      const text = await this.readCapped(res);
      try {
        return JSON.parse(text);
      } catch {
        throw new UpstreamError("invalid", "the node's answer is not JSON", res.status);
      }
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError("unavailable", `the node read failed: ${String((error as Error)?.message ?? error)}`);
    } finally {
      release();
    }
  }

  private async readCapped(res: Response): Promise<string> {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await res.body?.cancel();
      throw new UpstreamError("too_large", `the node's answer is over ${this.maxBytes} bytes`, res.status);
    }
    if (res.body === null) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel();
        throw new UpstreamError("too_large", `the node's answer is over ${this.maxBytes} bytes`, res.status);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  /** The deployment the node serves, from `/protocol-info`. */
  async protocolInfo(): Promise<{ manifestId: string }> {
    const body = (await this.get("/protocol-info")) as { deploymentMarker?: { manifestId?: unknown } } | null;
    const manifestId = body?.deploymentMarker?.manifestId;
    if (typeof manifestId !== "string") throw new UpstreamError("invalid", "the node's protocol info names no deployment");
    return { manifestId };
  }

  /** The node's status for a transaction it may hold but no archive does. */
  async txStatus(txId: string): Promise<NodeTxStatus> {
    if (this.deploymentFingerprint !== undefined) {
      const info = await this.protocolInfo();
      if (info.manifestId !== this.deploymentFingerprint) {
        throw new UpstreamError("invalid", "the node serves a different deployment");
      }
    }
    const body = (await this.get(`/tx-status?tx_hash=${encodeURIComponent(txId)}`)) as NodeTxStatus | null;
    if (body === null) return { txId, status: "not_found" };
    if (typeof body.status !== "string") throw new UpstreamError("invalid", "the node's tx status has no status");
    return body;
  }
}
