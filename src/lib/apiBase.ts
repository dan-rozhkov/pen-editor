// Resolves backend API URLs from the same env vars the chat hook uses, so every
// caller (chat, model list, …) agrees on where the backend lives.
//
// - VITE_AI_API_URL: explicit full chat URL (e.g. https://host/api/chat). We
//   strip the trailing /api/chat to recover the base for other endpoints.
// - VITE_DESIGN_AGENT_BACKEND_URL: backend base URL.
// - neither set: same-origin (dev proxy / co-hosted).
function resolveBackendBase(): string {
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  if (explicitApiUrl) {
    return explicitApiUrl.replace(/\/api\/chat\/?$/, "");
  }

  const backendUrl = import.meta.env.VITE_DESIGN_AGENT_BACKEND_URL as
    | string
    | undefined;
  if (backendUrl) {
    return backendUrl.replace(/\/$/, "");
  }

  return "";
}

export function resolveApiUrl(path: string): string {
  return `${resolveBackendBase()}${path}`;
}

// Single source of truth for "is the backend reachable". Every network caller
// (chat, image generation, ChatInput's send-button title) used to check
// `!navigator.onLine` independently, which is easy to let drift. Centralizing
// it here doesn't change behavior, just where it lives.
export function isOffline(): boolean {
  return !navigator.onLine;
}

// Canonical copy for the chat surface: useDesignChat's offlineError and
// ChatInput's send-button title both describe the same "sending is
// unavailable" condition. Other offline messages (e.g. image generation) are
// genuinely surface-specific and keep their own wording.
export const OFFLINE_MESSAGE =
  "Offline. AI and backend features are disabled until the connection is restored.";

export const OFFLINE_SEND_TITLE = "Offline — sending is disabled";
