"use client";

import { createContext, useContext } from "react";

/**
 * Which node the reader is looking at.
 *
 * A context rather than a prop, because every card in the graph can start an
 * inspection and none of them is a parent of the others.
 */
export type InspectionState = {
  inspectedNodeId: string | null;
  inspectNode: (id: string) => void;
};

export const InspectionContext = createContext<InspectionState | null>(null);

export const useInspection = () => useContext(InspectionContext);
