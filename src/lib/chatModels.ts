// The chat model list and per-model capabilities. The backend is the source of
// truth (GET /api/models); this module fetches it once at startup and caches it.
// The hardcoded FALLBACK_MODELS below is only a first-paint/offline safety net —
// keep it roughly in sync with the backend's DEFAULT_MODELS, but the backend
// always wins once it responds.
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

// Sentinel selection that resolves to whatever the backend reports as its
// default model (currently DeepSeek V4 Pro). Exposed as a synthetic "Auto"
// option at the top of the list so the user doesn't have to track which
// concrete model is the recommended default.
export const AUTO_MODEL_VALUE = "auto";

const AUTO_OPTION: ChatModelOption = {
  value: AUTO_MODEL_VALUE,
  label: "Auto",
  supportsVision: true,
};

const FALLBACK_MODELS: ChatModelOption[] = [
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    supportsVision: true,
  },
  {
    value: "z-ai/glm-5.2",
    label: "GLM 5.2",
    supportsVision: false,
  },
  {
    value: "moonshotai/kimi-k2.5",
    label: "Kimi K2.5",
    supportsVision: true,
  },
  {
    value: "minimax/minimax-m3",
    label: "Minimax M3",
    supportsVision: true,
  },
  {
    value: "xiaomi/mimo-v2.5-pro",
    label: "MiMo V2.5 Pro",
    supportsVision: false,
  },
  {
    value: "xiaomi/mimo-v2.5",
    label: "MiMo V2.5",
    supportsVision: true,
  },
  {
    value: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    supportsVision: false,
  },
  {
    value: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    supportsVision: false,
  },
  { value: "tencent/hy3", label: "Hy3", supportsVision: false },
  {
    value: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra",
    supportsVision: false,
  },
  {
    value: "stepfun/step-3.7-flash",
    label: "Step 3.7 Flash",
    supportsVision: true,
  },
  {
    value: "x-ai/grok-build-0.1",
    label: "Grok Build 0.1",
    supportsVision: true,
  },
  {
    value: "thinkingmachines/inkling",
    label: "Inkling",
    supportsVision: true,
  },
  {
    value: "kwaipilot/kat-coder-pro-v2.5",
    label: "KAT-Coder-Pro V2.5",
    supportsVision: false,
  },
  {
    value: "x-ai/grok-4.20",
    label: "Grok 4.20",
    supportsVision: false,
  },
  {
    value: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    supportsVision: true,
  },
  {
    value: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    supportsVision: true,
  },
];

// Mirrors the backend's OPENROUTER_MODEL default (pen-editor-backend
// src/config.ts). It must be an id the backend allows: a request sent before
// GET /api/models resolves carries this id, and an unknown one is rejected
// with a 400. `modelContract.test.ts` pins that against the sibling checkout.
const FALLBACK_AUTO_MODEL = "deepseek/deepseek-v4-pro";

// Backend wire shape (pen-editor-backend GET /api/models).
interface ModelsResponse {
  models: { id: string; label: string; supportsVision: boolean }[];
  default: string;
  visionFallback: boolean;
  imageOps?: { removeBackground: boolean; vectorize: boolean };
}

let currentModels: ChatModelOption[] = [AUTO_OPTION, ...FALLBACK_MODELS];
// The concrete model that "Auto" resolves to — the backend's reported default.
let autoTargetModel: string = FALLBACK_AUTO_MODEL;
// Whether the backend has an auxiliary vision model configured, so it can
// accept images for ANY model (not just ones with native vision) by
// describing them as text server-side. Default false — conservative until
// the backend confirms it, since we can't promise a capability we haven't
// verified.
let visionFallback = false;
// Whether the backend has each image-op route configured (remove-background/
// vectorize need their own upstream provider credentials, independent of
// OPENROUTER_*/VISION_MODEL). Same conservative-false-until-confirmed
// reasoning as visionFallback above: canRemoveBackground()/canVectorize()
// gate whether the corresponding agent tool/UI button is offered at all, and
// offering one the backend can't actually serve would just fail every call.
let imageOpsCapabilities = { removeBackground: false, vectorize: false };
// Whether loadModels() has settled — success OR failure. Callers that can
// choose *when* to send (the showcase handoff, which auto-sends the moment the
// editor mounts) wait on this so they travel with the backend's own list
// instead of the fallback above. A failed fetch still flips it: the fallback is
// then all we will ever have, and blocking forever would be worse.
let modelsSettled = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getModelOptions(): ChatModelOption[] {
  return currentModels;
}

// True while a GET /api/models call is in flight — i.e. the cached list is
// still the hardcoded fallback but a better one is on its way. Callers that
// auto-send (queued launch payloads) hold off while this is true rather than
// committing to a fallback model id the backend may not allow. It is false
// before anyone starts a load at all, so a context that never calls
// loadModels() (tests, embedded harnesses) is never blocked. Subscribers are
// notified via subscribeModels when it flips, including on a failed fetch.
export function isModelListPending(): boolean {
  return loadPromise !== null && !modelsSettled;
}

// The default selection is always "Auto"; it resolves to the backend default.
export function getDefaultModel(): string {
  return AUTO_MODEL_VALUE;
}

// Map a selected model value to the concrete id sent to the backend. Only
// "Auto" is indirected; every other value passes through unchanged.
export function resolveModel(model: string): string {
  return model === AUTO_MODEL_VALUE ? autoTargetModel : model;
}

export function modelSupportsVision(model: string): boolean {
  const resolved = resolveModel(model);
  // Unknown models (e.g. a custom OPENROUTER_MODEL not in the list) are assumed
  // vision-capable; the stripping is a safety net, not a hard gate.
  return (
    currentModels.find((option) => option.value === resolved)?.supportsVision ??
    true
  );
}

// Whether the app may let the user attach an image for this model at all.
// True if the model has native vision, OR if the backend has an auxiliary
// vision model configured (visionFallback) — in that case the image is
// still sent, but the backend converts it to a text description before it
// reaches a non-vision model, so fine visual detail (exact colors, small
// text, precise layout) is lost even though the image itself is "read".
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

// Subscription surface for React (useSyncExternalStore) so dropdowns re-render
// when the backend list lands.
export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Fetch the model list from the backend once. Safe to call repeatedly — the
// in-flight promise is shared. On any failure we silently keep the fallback.
export function loadModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(resolveApiUrl("/api/models"));
      if (!res.ok) return;
      const data = (await res.json()) as ModelsResponse;
      if (!Array.isArray(data.models) || data.models.length === 0) return;
      currentModels = [
        AUTO_OPTION,
        ...data.models.map((m) => ({
          value: m.id,
          label: m.label,
          supportsVision: m.supportsVision,
        })),
      ];
      if (data.default) autoTargetModel = data.default;
      visionFallback = data.visionFallback ?? false;
      imageOpsCapabilities = {
        removeBackground: data.imageOps?.removeBackground ?? false,
        vectorize: data.imageOps?.vectorize ?? false,
      };
    } catch {
      // Network/parse error — keep the hardcoded fallback.
    } finally {
      // Always, on every exit path (including the early returns above and a
      // failed fetch): waiters must be released even when all we have is the
      // fallback, or a backend that is down would hang the showcase handoff.
      modelsSettled = true;
      notify();
    }
  })();
  return loadPromise;
}
