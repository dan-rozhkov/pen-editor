// The chat model list and per-model capabilities. The backend is the source of
// truth (GET /api/models); this module fetches it once at startup and caches it.
// The hardcoded FALLBACK_MODELS below is only a first-paint/offline safety net —
// keep it roughly in sync with the backend's DEFAULT_MODELS, but the backend
// always wins once it responds.
//
// `supportsVision: false` models get image parts stripped before sending (see
// useDesignChat) and image attaching disabled in ChatInput.

import { resolveApiUrl } from "@/lib/apiBase";

export interface ChatModelOption {
  value: string;
  label: string;
  supportsVision: boolean;
}

const FALLBACK_MODELS: ChatModelOption[] = [
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    supportsVision: true,
  },
  {
    value: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    supportsVision: true,
  },
  {
    value: "minimax/minimax-m3",
    label: "Minimax M3",
    supportsVision: true,
  },
];

// Backend wire shape (pen-editor-backend GET /api/models).
interface ModelsResponse {
  models: { id: string; label: string; supportsVision: boolean }[];
  default: string;
}

let currentModels: ChatModelOption[] = FALLBACK_MODELS;
let defaultModel: string = FALLBACK_MODELS[0].value;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getModelOptions(): ChatModelOption[] {
  return currentModels;
}

export function getDefaultModel(): string {
  return defaultModel;
}

export function modelSupportsVision(model: string): boolean {
  // Unknown models (e.g. a custom OPENROUTER_MODEL not in the list) are assumed
  // vision-capable; the stripping is a safety net, not a hard gate.
  return (
    currentModels.find((option) => option.value === model)?.supportsVision ??
    true
  );
}

// Subscription surface for React (useSyncExternalStore) so dropdowns re-render
// when the backend list lands.
export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let loadPromise: Promise<void> | null = null;

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
      currentModels = data.models.map((m) => ({
        value: m.id,
        label: m.label,
        supportsVision: m.supportsVision,
      }));
      if (data.default) defaultModel = data.default;
      notify();
    } catch {
      // Network/parse error — keep the hardcoded fallback.
    }
  })();
  return loadPromise;
}
