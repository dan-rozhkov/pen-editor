import { create } from "zustand";
import type { FixtureNetworkRule, PageFixture } from "@sideform/browser-agent/fixture";

/**
 * Browser checkpoints taken at the end of browse_agent runs, per chat, so a
 * later `browse_agent({ resume })` can rebuild the page.
 *
 * SECRETS: `fixture` holds cookie and storage values and typed text. This store
 * is in-memory ONLY: no `persist`, never localStorage / IndexedDB, never read by
 * the model, a log, the chat export or analytics. Only `id`, `complete`,
 * `summary` and `gap` ever leave it (see `checkpointForModel`). A reload loses
 * every checkpoint on purpose.
 */
export const MAX_CHECKPOINTS_PER_CHAT = 12;

export interface BrowseCheckpoint {
  id: string;
  fixture: PageFixture;
  /** Network mocks of the run that took the checkpoint (the fixture itself carries none). */
  network?: FixtureNetworkRule[];
  complete: boolean;
  gap?: string;
  summary: string;
  /**
   * Recorded in an isolated QA run: the fixture holds the test account's cookies,
   * so only another isolated run may resume it. Never sent to the model.
   */
  isolated?: true;
  createdAt: number;
}

export type NewBrowseCheckpoint = Omit<BrowseCheckpoint, "id" | "createdAt">;

interface BrowseCheckpointState {
  byChat: Record<string, BrowseCheckpoint[]>;
  /** Stores a checkpoint (oldest dropped past the cap) and returns it. Ids: cp_1, cp_2, ... never reused within a chat. */
  add: (chatId: string, checkpoint: NewBrowseCheckpoint) => BrowseCheckpoint;
  get: (chatId: string, id: string) => BrowseCheckpoint | undefined;
  /** Drops a chat's checkpoints and bumps its generation (ids keep rising). */
  clearChat: (chatId: string) => void;
  /** clearChat plus the chat's id counter: the chat is gone for good. */
  deleteChat: (chatId: string) => void;
  /**
   * Bumped by clearChat/deleteChat. A run reads it when it starts recording and
   * skips `add` if it changed, so a run in flight when the chat was cleared
   * cannot recreate the chat's entry.
   */
  generation: (chatId: string) => number;
}

/** Next id number per chat; survives eviction so an id never points at a different checkpoint. */
const counters = new Map<string, number>();
/** Per-chat clear generation. Kept after delete on purpose (a small int): a reset to 0 would match a run that started at 0. */
const generations = new Map<string, number>();

export const useBrowseCheckpointStore = create<BrowseCheckpointState>((set, getState) => ({
  byChat: {},
  add: (chatId, checkpoint) => {
    const n = (counters.get(chatId) ?? 0) + 1;
    counters.set(chatId, n);
    const entry: BrowseCheckpoint = { ...checkpoint, id: `cp_${n}`, createdAt: Date.now() };
    set((s) => ({
      byChat: { ...s.byChat, [chatId]: [...(s.byChat[chatId] ?? []), entry].slice(-MAX_CHECKPOINTS_PER_CHAT) },
    }));
    return entry;
  },
  get: (chatId, id) => getState().byChat[chatId]?.find((c) => c.id === id),
  clearChat: (chatId) => {
    generations.set(chatId, (generations.get(chatId) ?? 0) + 1);
    set((s) => {
      if (!(chatId in s.byChat)) return s;
      const byChat = { ...s.byChat };
      delete byChat[chatId];
      return { byChat };
    });
  },
  deleteChat: (chatId) => {
    getState().clearChat(chatId);
    counters.delete(chatId);
  },
  generation: (chatId) => generations.get(chatId) ?? 0,
}));

/** The model-safe view of a checkpoint: no fixture, no network rules. */
export function checkpointForModel(c: BrowseCheckpoint): { id: string; complete: boolean; summary: string; gap?: string } {
  return { id: c.id, complete: c.complete, summary: c.summary, ...(c.gap !== undefined ? { gap: c.gap } : {}) };
}

/** Test helper: forget ids and entries. */
export function resetBrowseCheckpoints(): void {
  counters.clear();
  generations.clear();
  useBrowseCheckpointStore.setState({ byChat: {} });
}
