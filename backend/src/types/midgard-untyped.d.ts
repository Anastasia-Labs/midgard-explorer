/**
 * Declarations for the vendored Midgard packages that ship none.
 *
 * `@al-ft/midgard-fault-proofs` is packed without `.d.ts` files (Midgard
 * f4cf28ca1; upstream report item 10). Only the symbols the explorer calls are
 * declared, with signatures copied from
 * `demo/midgard-fault-proofs/src/transition-trace/fetch.*.ts` at that commit.
 */
declare module "@al-ft/midgard-fault-proofs" {
  export type RetainedDaFetchAttempt = {
    readonly sourceId: string;
    readonly sourcePeerId: string;
    readonly protocol: string;
    readonly status:
      | "not_found"
      | "transport_error"
      | "timeout"
      | "invalid_content"
      | "rejected"
      | "conflict"
      | "failed_verification";
    readonly detail: string;
  };

  export type RetainedDaPayloadVerifier = (
    payloadEnvelopeCbor: Buffer,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;

  export type RetainedDaPayloadFetchResult = {
    readonly provenance: unknown;
    readonly sourceId: string;
    readonly sourcePeerId: string;
    readonly payloadEnvelopeCbor: Buffer;
    readonly metadata: unknown;
    readonly attempts: readonly RetainedDaFetchAttempt[];
  };

  export type RetainedDaPayloadSourceResult =
    | ({ readonly ok: true } & RetainedDaPayloadFetchResult)
    | { readonly ok: false; readonly sourceId: string; readonly attempts: readonly RetainedDaFetchAttempt[] };

  export interface RetainedDaPayloadSource {
    readonly sourceId: string;
    fetchPayloadByHeaderHash(
      headerHash: string,
      options?: { readonly verifyPayload?: RetainedDaPayloadVerifier },
    ): Promise<RetainedDaPayloadSourceResult>;
  }

  export function fetchRetainedDaPayloadByHeaderHash(options: {
    readonly headerHash: string;
    readonly sources: readonly RetainedDaPayloadSource[];
    readonly retries?: number;
  }): Promise<RetainedDaPayloadFetchResult>;

  export class RetainedDaPayloadUnavailableError extends Error {}
}

/**
 * `midgard-watcher` is also packed without `.d.ts` files. The explorer uses
 * only its public-DA libp2p transport
 * (`demo/midgard-watcher/src/storage/public-da-libp2p-transport.ts`).
 */
declare module "midgard-watcher" {
  export type WatcherPublicDaRequest = Readonly<{
    peerIdentity: string;
    peerId: string;
    multiaddr: string;
    protocol: string;
    protocolId: string;
    requestCbor: Buffer;
    timeoutMs: number;
    signal: AbortSignal;
  }>;

  export interface WatcherPublicDaLibp2pTransport {
    request(request: WatcherPublicDaRequest): Promise<Uint8Array>;
    stop(): Promise<void>;
  }

  export function createWatcherPublicDaLibp2pTransport(options?: {
    readonly maxFrameBytes?: number;
  }): Promise<WatcherPublicDaLibp2pTransport>;
}

declare module "@al-ft/midgard-fault-proofs" {
  export type RetainedDaLibp2pRequest = {
    readonly peer: { readonly peerId: string };
    readonly protocol: string;
    readonly payload: Buffer;
    readonly timeoutMs: number;
  };

  export interface RetainedDaLibp2pTransport {
    request(args: RetainedDaLibp2pRequest): Promise<Uint8Array>;
  }

  export class DaLibp2pRetainedDaSource implements RetainedDaPayloadSource {
    constructor(options: {
      readonly sourceId?: string;
      readonly deploymentFingerprint: string;
      readonly peers: readonly { readonly peerId: string }[];
      readonly transport: RetainedDaLibp2pTransport;
      readonly timeoutMs?: number;
      readonly maxInlineResponseBytes?: number;
      readonly maxChunkBytes?: number;
    });
    readonly sourceId: string;
    fetchPayloadByHeaderHash(
      headerHash: string,
      options?: { readonly verifyPayload?: RetainedDaPayloadVerifier },
    ): Promise<RetainedDaPayloadSourceResult>;
  }
}
