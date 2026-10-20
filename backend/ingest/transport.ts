/// <reference path="../src/types/midgard-untyped.d.ts" />
import type { RetainedDaLibp2pRequest, RetainedDaLibp2pTransport } from "@al-ft/midgard-fault-proofs";
import type { WatcherPublicDaLibp2pTransport } from "midgard-watcher";

type DaTransport = typeof import("@al-ft/midgard-core/da-transport", {
  with: { "resolution-mode": "import" },
});

/** A DA peer: its libp2p id and the `/dns4/<host>/tcp/<port>/p2p/<id>` address it listens on. */
export type DaPeer = { peerId: string; multiaddr: string };

/**
 * Midgard's retained-DA source speaks to peers through this, and the
 * watcher's public-DA libp2p transport carries it: the same adaptation the
 * watcher makes for itself, which its package does not export (upstream
 * report item 6). The watcher accepts only a direct `/dns4` or `/dns6` TCP
 * address on a named network, so a local peer is `/dns4/localhost/...`.
 */
export function retainedDaTransport(
  watcher: WatcherPublicDaLibp2pTransport,
  daTransport: DaTransport,
  deploymentFingerprint: string,
  peers: readonly DaPeer[],
): RetainedDaLibp2pTransport {
  const byId = new Map(peers.map((peer) => [peer.peerId, peer]));
  return {
    async request(args: RetainedDaLibp2pRequest): Promise<Uint8Array> {
      const peer = byId.get(args.peer.peerId);
      if (peer === undefined) throw new Error(`no address configured for DA peer ${args.peer.peerId}`);
      return watcher.request({
        peerIdentity: peer.peerId,
        peerId: peer.peerId,
        multiaddr: peer.multiaddr,
        protocol: args.protocol,
        protocolId: daTransport.daRequestResponseProtocolId(
          deploymentFingerprint,
          args.protocol as Parameters<DaTransport["daRequestResponseProtocolId"]>[1],
        ),
        requestCbor: args.payload,
        timeoutMs: args.timeoutMs,
        signal: AbortSignal.timeout(args.timeoutMs),
      });
    },
  };
}
