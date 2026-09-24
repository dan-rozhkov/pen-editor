import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";

// Shared by imageAdjustments.test.ts and imageCrop.test.ts (also mirrored in
// mutations.test.ts).

export function scene() {
  return useSceneStore.getState();
}

// Replicate the real undo/redo cycle from useCanvasKeyboardShortcuts:
// snapshot current -> ask history for the target -> restore it if present.
export function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

export function redo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const next = useHistoryStore.getState().redo(snapshot);
  if (next) useSceneStore.getState().restoreSnapshot(next);
  return next;
}
