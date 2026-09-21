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
import { hasOpenCodeKey } from "@/lib/opencodeKey";

export interface ChatModelOption {
  value: string;
  label: string;
  supportsVision: boolean;
  /**
   * True when this model only ever works with a key the user entered in
   * their own browser (OpenCode BYOK — see pen-editor-backend's
   * docs/specs/2026-09-18-opencode-byok-design.md and src/config.ts's
   * `ModelOption.requiresUserKey`). Absent/false for every OpenRouter
   * entry. Mirrors the backend's field name and semantics exactly so
   * `GET /api/models`' payload can be forwarded with no translation.
   */
  requiresUserKey?: boolean;
  /**
   * The model's context window in tokens, when the backend reports one.
   * Absent (not `undefined`-valued, actually missing) for a model the
   * backend hasn't sized — same "include the key only when we have it"
   * convention as `requiresUserKey` above. Drives ContextMeter
   * (components/chat/ContextMeter.tsx); a model with no known window never
   * shows a meter rather than guessing at a default.
   */
  contextWindow?: number;
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
    contextWindow: 1048576,
  },
  {
    value: "qwen/qwen3.8-flash",
    label: "Qwen3.8 Flash",
    supportsVision: true,
    contextWindow: 1000000,
  },
  {
    value: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    supportsVision: true,
    contextWindow: 1310720,
  },
  {
    value: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    supportsVision: true,
    contextWindow: 1048576,
  },
  {
    value: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    supportsVision: true,
    contextWindow: 1048576,
  },
  {
    value: "tencent/hy4-preview",
    label: "Hy4 Preview",
    supportsVision: false,
    contextWindow: 1048576,
  },
  {
    value: "z-ai/glm-5.3",
    label: "GLM 5.3",
    supportsVision: false,
    contextWindow: 1310720,
  },
  {
    value: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    supportsVision: true,
    contextWindow: 1050000,
  },
  {
    value: "z-ai/glm-5.2",
    label: "GLM 5.2",
    supportsVision: false,
    contextWindow: 1048576,
  },
  // Known caveat, kept in sync with the backend's note on this id: on the
  // design-agent prompt MiniMax M3 fairly often ends a turn with reasoning
  // only and no tool call, and nothing retries that (the retry fires only
  // before the first content chunk). An empty-looking turn here is the model.
  {
    value: "minimax/minimax-m3",
    label: "MiniMax M3",
    supportsVision: true,
    contextWindow: 1048576,
  },
  // --- OpenCode BYOK (pen-editor-backend docs/specs/2026-09-18-opencode-
  // byok-design.md) --- Nine entries mirroring the backend's DEFAULT_MODELS
  // verbatim (id, label, supportsVision, contextWindow) —
  // modelContract.test.ts pins the two lists against each other from the
  // sibling checkout, so a drift here fails that test rather than silently
  // mismatching the picker.
  {
    value: "opencode-go/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash · Go",
    supportsVision: true,
    requiresUserKey: true,
    contextWindow: 1048576,
  },
  {
    value: "opencode-go/deepseek-v4-flash-vision-exp",
    label: "DeepSeek V4 Flash Vision · Go",
    supportsVision: true,
    requiresUserKey: true,
    contextWindow: 1048576,
  },
  {
    value: "opencode-go/glm-5.3-flash",
    label: "GLM 5.3 Flash · Go",
    supportsVision: true,
    requiresUserKey: true,
    contextWindow: 1310720,
  },
  {
    value: "opencode-go/glm-5.3",
    label: "GLM 5.3 · Go",
    supportsVision: false,
    requiresUserKey: true,
    contextWindow: 1310720,
  },
  {
    value: "opencode-go/glm-5.2",
    label: "GLM 5.2 · Go",
    supportsVision: false,
    requiresUserKey: true,
    contextWindow: 1048576,
  },
  {
    value: "opencode/deepseek-v4-flash",
    label: "DeepSeek V4 Flash · Zen",
    supportsVision: false,
    requiresUserKey: true,
    contextWindow: 1048576,
  },
  {
    value: "opencode/glm-5.3-flash",
    label: "GLM 5.3 Flash · Zen",
    supportsVision: true,
    requiresUserKey: true,
    contextWindow: 1310720,
  },
  {
    value: "opencode/kimi-k2.7-code",
    label: "Kimi K2.7 Code · Zen",
    supportsVision: true,
    requiresUserKey: true,
    contextWindow: 262144,
  },
  // supportsVision is deliberately conservative-false here, unlike its
  // OpenRouter twin above — nobody has run the live vision smoke against
  // Zen's minimax-m3 yet. See the backend's config.ts for the full note.
  {
    value: "opencode/minimax-m3",
    label: "MiniMax M3 · Zen",
    supportsVision: false,
    requiresUserKey: true,
    contextWindow: 1048576,
  },
];

// Mirrors the backend's CHAT_MODEL default. Only used until GET /api/models
// answers with its own `default`.
const FALLBACK_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

// Backend wire shape (pen-editor-backend GET /api/models).
interface ModelsResponse {
  models: {
    id: string;
    label: string;
    supportsVision: boolean;
    requiresUserKey?: boolean;
    contextWindow?: number;
  }[];
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

/**
 * `model`'s context window in tokens, or `undefined` when the backend
 * hasn't reported one (an id it doesn't know, or an older backend that
 * predates this field). Never a guessed default — ContextMeter treats
 * `undefined` as "don't show a meter" rather than picking a number.
 */
export function getModelContextWindow(model: string): number | undefined {
  return currentModels.find((option) => option.value === model)?.contextWindow;
}

// Whether `model` is currently selectable at all: known to the backend list
// (an unknown id is harmless to pick — the backend just ignores it and runs
// its default — but there is no reason to let the picker show one that
// isn't real), and, if it's an OpenCode BYOK entry, only when this browser
// actually has a key stored. Used both by the picker (lock icon + disabled
// radio item) and by reconcileModels() (chatStore.ts) to decide whether a
// saved selection must fall back to the default — the same rule, so a
// selection that's disabled in the UI can never linger as the active model.
export function canUseModel(value: string): boolean {
  const option = currentModels.find((o) => o.value === value);
  if (!option) return false;
  return !option.requiresUserKey || hasOpenCodeKey();
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
          ...(m.requiresUserKey ? { requiresUserKey: true } : {}),
          ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
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
