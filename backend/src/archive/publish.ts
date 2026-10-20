import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { crashAt } from "./fsStore";
import { controlKey, generationKey } from "./keys";
import { Control, emptyIndexes, type Generation, type Indexes, type Lease } from "./schema";
import type { ArchiveStore } from "./store";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Another writer holds an unexpired lease. */
export class LeaseHeld extends Error {
  readonly holder: string;
  constructor(holder: string) {
    super(`the archive lease is held by ${holder}`);
    this.holder = holder;
    this.name = "LeaseHeld";
  }
}

export type WriterOptions = {
  store: ArchiveStore;
  fingerprint: string;
  owner: string;
  leaseMs: number;
  now?: () => number;
  /** Test seams. Nothing in production sets them. */
  hooks?: { beforePublishSwap?: () => Promise<void> };
};

export type GenerationContent = {
  /** Content objects, written with putImmutable before anything references them. */
  objects: Record<string, Uint8Array>;
  /**
   * Keys a published generation already references, carried into this one
   * without being read again. They are immutable and existed before that
   * generation was published.
   */
  carried?: readonly string[];
  seeds?: unknown[];
  outcomes?: Record<string, unknown>;
  coverage?: Record<string, unknown>;
  metrics?: Record<string, string>;
  index?: Indexes;
};

const SWAP_ATTEMPTS = 5;

/**
 * One archive writer and the publication protocol.
 *
 * Takeover and publish are compare-and-swaps of the same `control` object, so
 * neither can happen between the other's read and its write. A writer whose
 * lease was taken, or ran out, finds out at its swap: the swap fails on the
 * etag or the check before it fails on the lease, and `head` never names its
 * generation. Expiry is judged by the clock of whoever attempts a takeover, with
 * a margin of one lease period, so clock skew costs liveness and never safety.
 */
export class ArchiveWriter {
  private readonly options: WriterOptions;
  private readonly now: () => number;
  /**
   * This writer instance, not its host or process: a host name and pid can be
   * reused, so a lease names `<owner>#<random uuid>`, and a new instance never
   * inherits a lease, even one written under the same owner name.
   */
  private readonly instance: string;
  private fence: number | null = null;

  constructor(options: WriterOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.instance = `${options.owner}#${randomUUID()}`;
  }

  private async readControl() {
    const found = await this.options.store.get(controlKey(this.options.fingerprint));
    if (found === null) return { control: { lease: null, head: null } as Control, etag: null };
    return { control: Control.parse(JSON.parse(new TextDecoder().decode(found.bytes))), etag: found.etag };
  }

  private lease(fence: number): Lease {
    return {
      owner: this.instance,
      host: hostname(),
      pid: process.pid,
      expiresAt: this.now() + this.options.leaseMs,
      fence,
    };
  }

  /** Takes the lease, or renews it when this writer already holds it. */
  async acquire(): Promise<number> {
    for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt += 1) {
      const { control, etag } = await this.readControl();
      const held = control.lease;
      // A released lease is never renewed into: taking it again advances the fence.
      const mine = held !== null && held.owner === this.instance && held.expiresAt !== 0;
      // A released lease has expiresAt 0 and is free at once; any other is
      // judged with a margin of one lease period against clock skew.
      const expired =
        held !== null && (held.expiresAt === 0 || held.expiresAt + this.options.leaseMs < this.now());
      if (held !== null && !mine && !expired) throw new LeaseHeld(held.owner);
      const fence = mine ? held.fence : (held?.fence ?? 0) + 1;
      const next: Control = { lease: this.lease(fence), head: control.head };
      const swapped = await this.options.store.putIfMatch(
        controlKey(this.options.fingerprint),
        encode(next),
        etag,
      );
      if (swapped.ok) {
        this.fence = fence;
        return fence;
      }
    }
    throw new Error("the archive lease could not be taken: control kept changing");
  }

  /** Whether `control` still names this writer's lease, at its fence. */
  private holds(control: Control): control is Control & { lease: Lease } {
    const lease = control.lease;
    return lease !== null && lease.owner === this.instance && lease.fence === this.fence;
  }

  /**
   * Extends this writer's lease. False once the lease was lost, to a takeover
   * or to expiry, and then this writer must stop: it can no longer publish.
   */
  async renew(): Promise<boolean> {
    for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt += 1) {
      const { control, etag } = await this.readControl();
      if (!this.holds(control) || control.lease.expiresAt <= this.now()) return false;
      const next: Control = { lease: { ...control.lease, expiresAt: this.now() + this.options.leaseMs }, head: control.head };
      if ((await this.options.store.putIfMatch(controlKey(this.options.fingerprint), encode(next), etag)).ok) {
        return true;
      }
    }
    return false;
  }

  /**
   * Gives the lease up, keeping `head`. Only this writer's own lease, at its
   * own fence, is touched: a writer releasing after a takeover changes nothing.
   * The lease is left in place, expired, rather than removed, so the fence it
   * carries is never reused: the next writer takes over at once with fence + 1.
   */
  async release(): Promise<boolean> {
    for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt += 1) {
      const { control, etag } = await this.readControl();
      if (!this.holds(control)) return false;
      const next: Control = { lease: { ...control.lease, expiresAt: 0 }, head: control.head };
      if ((await this.options.store.putIfMatch(controlKey(this.options.fingerprint), encode(next), etag)).ok) {
        this.fence = null;
        return true;
      }
    }
    return false;
  }

  /**
   * Writes the content, then publishes a generation over it. Returns false when
   * this writer no longer holds the lease, in which case nothing it wrote is
   * referenced by `head`.
   */
  async publish(content: GenerationContent): Promise<boolean> {
    if (this.fence === null) throw new Error("acquire the lease before publishing");
    const { store, fingerprint } = this.options;
    for (const [key, bytes] of Object.entries(content.objects)) await store.putImmutable(key, bytes);
    crashAt("publish:after-objects");

    for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt += 1) {
      const before = await this.readControl();
      const n = (before.control.head?.n ?? 0) + 1;
      const generation: Generation = {
        n,
        parent: before.control.head?.generationKey ?? null,
        fence: this.fence,
        references: [...new Set([...(content.carried ?? []), ...Object.keys(content.objects)])].sort(),
        seeds: content.seeds ?? [],
        outcomes: content.outcomes ?? {},
        coverage: content.coverage ?? {},
        metrics: content.metrics ?? {},
        index: content.index ?? emptyIndexes(),
      };
      const bytes = encode(generation);
      const key = generationKey(fingerprint, n, sha256(bytes));
      await store.putImmutable(key, bytes);
      crashAt("publish:after-generation");

      const { control, etag } = await this.readControl();
      const lease = control.lease;
      const holding =
        lease !== null &&
        lease.owner === this.instance &&
        lease.fence === this.fence &&
        lease.expiresAt > this.now();
      if (!holding) return false;
      await this.options.hooks?.beforePublishSwap?.();
      const swapped = await store.putIfMatch(
        controlKey(fingerprint),
        encode({ lease, head: { generationKey: key, n } } satisfies Control),
        etag,
      );
      if (swapped.ok) return true;
      // Lost the swap. Either the lease moved, which the next read reports, or
      // the head did, and the generation is rebuilt on the new one.
    }
    return false;
  }
}
