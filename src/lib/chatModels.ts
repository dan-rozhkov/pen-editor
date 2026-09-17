// The chat model list and per-model capabilities. The backend is the source
// of truth (GET /api/models): it serves the selectable models plus the one
// that runs when a request names none, and this module fetches that once at
// startup and caches it. The user's pick travels with every turn as
// `model` (see useDesignChat's buildCanvasContext).
//
// `supportsVision` reports NATIVE vision only. Whether an image may be
// attached at all is `canSendImages` below, which also allows a
// non-native-vision model when the backend reports `visionFallback` (an
// auxiliary vision model describes the image as text server-side).

import { resolveApiUrl } from "@/lib/apiBase";

export interface ChatModelOption {
  value: string;
  label: string;
  supportsVision: boolean;
}

// First-paint/offline safety net, mirroring the backend's DEFAULT_MODELS
// (pen-editor-backend src/config.ts) — `modelContract.test.ts` pins the two
// against each other from the sibling checkout. A drifting id here cannot
// break a turn (the backend IGNORES an id outside its own list and runs its
// default instead), but it would show the user a menu that doesn't match
// what they get, so keep it honest.
const FALLBACK_MODELS: ChatModelOption[] = [
  {
    value: "meta/muse-spark-1.3-contributor",
    label: "Muse Spark 1.3",
    supportsVision: true,
  },
  { value: "qwen/qwen3.8-flash", label: "Qwen3.8 Flash", supportsVision: true },
  { value: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", supportsVision: true },
  {
    value: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    supportsVision: true,
  },
  { value: "stealth/union-alpha", label: "Union Alpha", supportsVision: true },
  {
    value: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    supportsVision: true,
  },
  { value: "tencent/hy4-preview", label: "Hy4 Preview", supportsVision: false },
  { value: "z-ai/glm-5.3", label: "GLM 5.3", supportsVision: false },
  {
    value: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    supportsVision: true,
  },
  { value: "z-ai/glm-5.2", label: "GLM 5.2", supportsVision: false },
];

// Mirrors the backend's CHAT_MODEL default. Only used until GET /api/models
// answers with its own `default`.
const FALLBACK_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

// Backend wire shape (pen-editor-backend GET /api/models).
interface ModelsResponse {
  models: { id: string; label: string; supportsVision: boolean }[];
  default: string;
  visionFallback: boolean;
  imageOps?: { removeBackground: boolean; vectorize: boolean };
}

let currentModels: ChatModelOption[] = FALLBACK_MODELS;
let defaultModel: string = FALLBACK_DEFAULT_MODEL;
// Whether the backend has an auxiliary vision model configured, so it can
// accept images even for a model without native vision (it describes them as
// text server-side). Default false — conservative until the backend confirms
// it, since we can't promise a capability we haven't verified.
let visionFallback = false;
// Whether the backend has each image-op route configured (remove-background/
// vectorize need their own upstream provider credentials, independent of
// OPENROUTER_API_KEY/VISION_MODEL). Same conservative-false-until-confirmed
// reasoning as visionFallback above: canRemoveBackground()/canVectorize()
// gate whether the corresponding agent tool/UI button is offered at all, and
// offering one the backend can't actually serve would just fail every call.
let imageOpsCapabilities = { removeBackground: false, vectorize: false };
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Every model the user may pick, as reported by the backend. */
export function getModelOptions(): ChatModelOption[] {
  return currentModels;
}

/** The model a turn runs on when nothing is selected (the backend's own). */
export function getDefaultModel(): string {
  return defaultModel;
}

/** Whether `model` reads images itself, without the backend's text fallback. */
export function modelSupportsVision(model: string): boolean {
  // An id we don't know (a stale selection, or a model the backend added
  // after this bundle was built) is assumed vision-capable, matching the
  // backend's own convention for an unlisted id.
  return currentModels.find((option) => option.value === model)?.supportsVision ?? true;
}

// Whether the app may let the user attach an image for this model at all.
// True if the model has native vision, OR if the backend has an auxiliary
// vision model configured (visionFallback) — in that case the image is still
// sent, but the backend converts it to a text description before it reaches
// the model, so fine visual detail (exact colors, small text, precise
// layout) is lost even though the image itself is "read".
export function canSendImages(model: string): boolean {
  return modelSupportsVision(model) || visionFallback;
}

/** Whether the backend can serve `remove_background`/the "Remove background" button. */
export function canRemoveBackground(): boolean {
  return imageOpsCapabilities.removeBackground;
}

/** Whether the backend can serve `vectorize_image`/the "Vectorize" button. */
export function canVectorize(): boolean {
  return imageOpsCapabilities.vectorize;
}

// Subscription surface for React (useSyncExternalStore) so the picker and
// capability-driven controls re-render when the backend metadata lands.
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
      if (Array.isArray(data.models) && data.models.length > 0) {
        currentModels = data.models.map((m) => ({
          value: m.id,
          label: m.label,
          supportsVision: m.supportsVision,
        }));
      }
      if (data.default) defaultModel = data.default;
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
