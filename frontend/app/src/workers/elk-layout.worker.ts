/// <reference lib="webworker" />

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkFlowGraph } from "../lib/flow";

const elk = new ELK();

self.onmessage = async (event: MessageEvent<{ id: number; graph: ElkFlowGraph }>) => {
  try {
    const data = (await elk.layout(event.data.graph)) as ElkFlowGraph;
    self.postMessage({ id: event.data.id, data });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
