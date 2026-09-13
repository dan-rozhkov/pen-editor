// The chat model and its capabilities. The design agent runs on exactly ONE
// model and there is no picker: the backend decides which one (its
// OPENROUTER_MODEL, reported as `default` by GET /api/models) and the browser
// never sends a model id with a turn. This module fetches that metadata once
// at startup and caches it.
//
// `supportsVision` reports NATIVE vision only. Whether an image may be
// attached at all is `canSendImages` below, which also allows a
// non-native-vision model when the backend reports `visionFallback` (an
// auxiliary vision model describes the image as text server-side).

import { resolveApiUrl } from "@/lib/apiBase";

export interface ChatModel {
  id: string;
  label: string;
  supportsVision: boolean;
}

// First-paint/offline safety net, mirroring the backend's DEFAULT_MODELS entry
// (pen-editor-backend src/config.ts). Nothing depends on the id being right —
// no request carries it — but the label is shown in the composer and
// `supportsVision` decides whether the attach button is live before the
// backend answers. `modelContract.test.ts` pins it against the sibling
// checkout.
const FALLBACK_MODEL: ChatModel = {
  id: "deepseek/deepseek-v4.1-flash",
  label: "DeepSeek V4.1 Flash",
  supportsVision: true,
};

// Backend wire shape (pen-editor-backend GET /api/models).
interface ModelsResponse {
  models: { id: string; label: string; supportsVision: boolean }[];
  default: string;
  visionFallback: boolean;
  imageOps?: { removeBackground: boolean; vectorize: boolean };
}

let currentModel: ChatModel = FALLBACK_MODEL;
// Whether the backend has an auxiliary vision model configured, so it can
// accept images even for a model without native vision (it describes them as
// text server-side). Default false — conservative until the backend confirms
// it, since we can't promise a capability we haven't verified.
let visionFallback = false;
// Whether the backend has each image-op route configured (remove-background/
// vectorize need their own upstream provider credentials, independent of
// OPENROUTER_*/VISION_MODEL). Same conservative-false-until-confirmed
// reasoning as visionFallback above: canRemoveBackground()/canVectorize()
// gate whether the corresponding agent tool/UI button is offered at all, and
// offering one the backend can't actually serve would just fail every call.
let imageOpsCapabilities = { removeBackground: false, vectorize: false };
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The single model every chat turn runs on, as reported by the backend. */
export function getChatModel(): ChatModel {
  return currentModel;
}

/** Whether the model reads images itself, without the backend's text fallback. */
export function modelSupportsVision(): boolean {
  return currentModel.supportsVision;
}

// Whether the app may let the user attach an image at all. True if the model
// has native vision, OR if the backend has an auxiliary vision model
// configured (visionFallback) — in that case the image is still sent, but the
// backend converts it to a text description before it reaches the model, so
// fine visual detail (exact colors, small text, precise layout) is lost even
// though the image itself is "read".
export function canSendImages(): boolean {
  return modelSupportsVision() || visionFallback;
}

/** Whether the backend can serve `remove_background`/the "Remove background" button. */
export function canRemoveBackground(): boolean {
  return imageOpsCapabilities.removeBackground;
}

/** Whether the backend can serve `vectorize_image`/the "Vectorize" button. */
export function canVectorize(): boolean {
  return imageOpsCapabilities.vectorize;
}

// Subscription surface for React (useSyncExternalStore) so capability-driven
// controls re-render when the backend metadata lands.
export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Fetch the model metadata from the backend once. Safe to call repeatedly —
// the in-flight promise is shared. On any failure we silently keep the
// fallback.
export function loadModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(resolveApiUrl("/api/models"));
      if (!res.ok) return;
      const data = (await res.json()) as ModelsResponse;
      const active = Array.isArray(data.models)
        ? (data.models.find((m) => m.id === data.default) ?? data.models[0])
        : undefined;
      if (active) {
        currentModel = {
          id: active.id,
          label: active.label,
          supportsVision: active.supportsVision,
        };
      }
      visionFallback = data.visionFallback ?? false;
      imageOpsCapabilities = {
        removeBackground: data.imageOps?.removeBackground ?? false,
        vectorize: data.imageOps?.vectorize ?? false,
      };
    } catch {
      // Network/parse error — keep the hardcoded fallback.
    } finally {
      notify();
    }
  })();
  return loadPromise;
}
