import { create } from "zustand";

/**
 * Phase of a running browse_agent call, keyed by its toolCallId. The handler
 * sets "setup" before it applies the page fixture and "running" after, and
 * clears the entry at the end. BrowseAgentIndicator reads it to tell
 * "Preparing page..." from "Running...". Transient, never persisted.
 */
export type BrowseAgentPhase = "setup" | "running";

interface BrowseAgentPhaseState {
  phases: Record<string, BrowseAgentPhase>;
  setPhase: (toolCallId: string, phase: BrowseAgentPhase) => void;
  clearPhase: (toolCallId: string) => void;
}

export const useBrowseAgentPhaseStore = create<BrowseAgentPhaseState>((set) => ({
  phases: {},
  setPhase: (toolCallId, phase) =>
    set((s) => (s.phases[toolCallId] === phase ? s : { phases: { ...s.phases, [toolCallId]: phase } })),
  clearPhase: (toolCallId) =>
    set((s) => {
      if (!(toolCallId in s.phases)) return s;
      const phases = { ...s.phases };
      delete phases[toolCallId];
      return { phases };
    }),
}));
