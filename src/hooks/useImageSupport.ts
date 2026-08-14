import { useCallback, useSyncExternalStore } from "react";
import { canSendImages, modelSupportsVision, subscribeModels } from "@/lib/chatModels";

// Both answers here depend on data that arrives asynchronously — the backend's
// model list and its `visionFallback` flag — so they are read through the
// models subscription. Calling canSendImages() straight in a render body would
// leave the composer's attach control stuck on its pre-fetch answer until some
// unrelated state change happened to re-render it.

/** Whether an image may be attached for this model at all. */
export function useCanSendImages(model: string): boolean {
  const getSnapshot = useCallback(() => canSendImages(model), [model]);
  return useSyncExternalStore(subscribeModels, getSnapshot, getSnapshot);
}

/**
 * Whether this model reads images itself, as opposed to via the backend's
 * auxiliary vision model. Affects only wording — never whether sending works.
 */
export function useModelSupportsVision(model: string): boolean {
  const getSnapshot = useCallback(() => modelSupportsVision(model), [model]);
  return useSyncExternalStore(subscribeModels, getSnapshot, getSnapshot);
}
