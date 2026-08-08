import { create } from "zustand";
import type { ParsedVectorDraft } from "@/lib/tools/drawVector/types";

export interface AiVectorPreviewDraft extends ParsedVectorDraft {
  sessionId: string;
  toolCallId: string;
  name: string;
  commandText: string;
  phase: "streaming" | "replaying" | "committing" | "failed";
  receivedDuringStreaming: boolean;
}

interface AiVectorPreviewState {
  drafts: Record<string, AiVectorPreviewDraft>;
  finalizedKeys: ReadonlySet<string>;
  upsert: (draft: AiVectorPreviewDraft) => void;
  markCommitting: (key: string) => void;
  clearDraft: (key: string) => void;
  clearSession: (sessionId: string) => void;
  finalizeCall: (key: string) => void;
  reset: () => void;
}

export function vectorPreviewKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function cloneDraft(draft: AiVectorPreviewDraft): AiVectorPreviewDraft {
  return {
    ...draft,
    points: draft.points.map((point) => ({
      ...point,
      handleIn: point.handleIn ? { ...point.handleIn } : point.handleIn,
      handleOut: point.handleOut ? { ...point.handleOut } : point.handleOut,
    })),
    bounds: { ...draft.bounds },
    stroke: draft.stroke ? { ...draft.stroke } : undefined,
  };
}

function handlesEqual(
  left: { x: number; y: number } | null | undefined,
  right: { x: number; y: number } | null | undefined,
): boolean {
  return left === right ||
    (left != null && right != null && left.x === right.x && left.y === right.y);
}

function draftsEqual(left: AiVectorPreviewDraft, right: AiVectorPreviewDraft): boolean {
  if (
    left.sessionId !== right.sessionId ||
    left.toolCallId !== right.toolCallId ||
    left.name !== right.name ||
    left.commandText !== right.commandText ||
    left.phase !== right.phase ||
    left.receivedDuringStreaming !== right.receivedDuringStreaming ||
    left.geometry !== right.geometry ||
    left.closed !== right.closed ||
    left.fill !== right.fill ||
    left.ended !== right.ended ||
    left.bounds.x !== right.bounds.x ||
    left.bounds.y !== right.bounds.y ||
    left.bounds.width !== right.bounds.width ||
    left.bounds.height !== right.bounds.height ||
    left.stroke?.color !== right.stroke?.color ||
    left.stroke?.width !== right.stroke?.width ||
    left.points.length !== right.points.length
  ) {
    return false;
  }

  return left.points.every((point, index) => {
    const other = right.points[index];
    return point.x === other.x &&
      point.y === other.y &&
      handlesEqual(point.handleIn, other.handleIn) &&
      handlesEqual(point.handleOut, other.handleOut);
  });
}

const emptyState = () => ({
  drafts: {} as Record<string, AiVectorPreviewDraft>,
  finalizedKeys: new Set<string>() as ReadonlySet<string>,
});

export const useAiVectorPreviewStore = create<AiVectorPreviewState>((set) => ({
  ...emptyState(),

  upsert: (draft) => set((state) => {
    const key = vectorPreviewKey(draft.sessionId, draft.toolCallId);
    if (state.finalizedKeys.has(key)) return state;

    const current = state.drafts[key];
    if (current && draftsEqual(current, draft)) return state;

    return {
      drafts: { ...state.drafts, [key]: cloneDraft(draft) },
    };
  }),

  markCommitting: (key) => set((state) => {
    const draft = state.drafts[key];
    if (!draft || state.finalizedKeys.has(key) || draft.phase === "committing") {
      return state;
    }
    return {
      drafts: {
        ...state.drafts,
        [key]: { ...draft, phase: "committing" },
      },
    };
  }),

  clearDraft: (key) => set((state) => {
    if (!(key in state.drafts)) return state;
    const drafts = { ...state.drafts };
    delete drafts[key];
    return { drafts };
  }),

  clearSession: (sessionId) => set((state) => {
    let changed = false;
    const drafts: Record<string, AiVectorPreviewDraft> = {};
    for (const [key, draft] of Object.entries(state.drafts)) {
      if (draft.sessionId === sessionId) {
        changed = true;
      } else {
        drafts[key] = draft;
      }
    }

    const prefix = `${sessionId}:`;
    const finalizedKeys = new Set<string>();
    for (const key of state.finalizedKeys) {
      if (key.startsWith(prefix)) {
        changed = true;
      } else {
        finalizedKeys.add(key);
      }
    }

    return changed ? { drafts, finalizedKeys } : state;
  }),

  finalizeCall: (key) => set((state) => {
    if (state.finalizedKeys.has(key) && !(key in state.drafts)) return state;

    const drafts = { ...state.drafts };
    delete drafts[key];
    const finalizedKeys = new Set(state.finalizedKeys);
    finalizedKeys.add(key);
    return { drafts, finalizedKeys };
  }),

  reset: () => set((state) => {
    if (Object.keys(state.drafts).length === 0 && state.finalizedKeys.size === 0) {
      return state;
    }
    return emptyState();
  }),
}));
