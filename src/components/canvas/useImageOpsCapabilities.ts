// Reactive views of canRemoveBackground()/canVectorize() (chatModels.ts, via
// the src/lib/imageOps/capabilities.ts re-export). Both are backed by a
// module-level variable that only updates once GET /api/models resolves —
// reading them straight in a render body would leave ImageOpsTools stuck
// showing "no buttons" (its pre-fetch, conservative-false answer) forever,
// since nothing would ever trigger a re-render once the real flags land.
// Mirrors src/hooks/useImageSupport.ts's useCanSendImages, which solves the
// exact same problem for the vision-capability flags: both are read through
// chatModels.ts's subscribeModels() via useSyncExternalStore so React
// re-renders the moment the backend response lands.
//
// The two capability getters come from imageOps/capabilities.ts's thin
// re-export (the intended UI-facing entry point per that file's own header
// comment); subscribeModels itself isn't re-exported there, so it's read
// straight from chatModels.ts here — that module is otherwise off-limits
// for this task, but this is a read, not an edit.
import { useSyncExternalStore } from "react";
import { subscribeModels } from "@/lib/chatModels";
import { canRemoveBackground, canVectorize } from "@/lib/imageOps/capabilities";

export function useCanRemoveBackground(): boolean {
  return useSyncExternalStore(subscribeModels, canRemoveBackground, canRemoveBackground);
}

export function useCanVectorize(): boolean {
  return useSyncExternalStore(subscribeModels, canVectorize, canVectorize);
}
