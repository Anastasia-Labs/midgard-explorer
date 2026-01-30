import type { Config } from "./types";

const env = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

export function getMidgardNodeUrl() {
  const midgardNode = env?.VITE_MIDGARD_NODE_URL;
  if (!midgardNode) {
    throw new Error("Missing required env: VITE_MIDGARD_NODE_URL");
  }
  return midgardNode;
}

export const config: Config = {
  midgardNode: getMidgardNodeUrl(),
};
