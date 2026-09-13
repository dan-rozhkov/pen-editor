import { useSyncExternalStore } from "react";
import { canSendImages, modelSupportsVision, subscribeModels } from "@/lib/chatModels";

// Both answers here depend on data that arrives asynchronously — the model's
// metadata and the backend's `visionFallback` flag — so they are read through
// the models subscription. Calling canSendImages() straight in a render body
// would leave the composer's attach control stuck on its pre-fetch answer
// until some unrelated state change happened to re-render it.

/** Whether an image may be attached at all. */
export function useCanSendImages(): boolean {
  return useSyncExternalStore(subscribeModels, canSendImages, canSendImages);
}

/**
 * Whether the model reads images itself, as opposed to via the backend's
 * auxiliary vision model. Affects only wording — never whether sending works.
 */
export function useModelSupportsVision(): boolean {
  return useSyncExternalStore(
    subscribeModels,
    modelSupportsVision,
    modelSupportsVision,
  );
}
