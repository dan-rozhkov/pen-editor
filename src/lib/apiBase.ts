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

// Every backend call must carry the session cookie (accounts, see
// src/lib/auth/): the one place that sets `credentials: "include"`. Callers
// never spell it themselves — use apiFetch (path) or apiFetchUrl (a URL that
// was already resolved, e.g. one with a query string built elsewhere).
// Credentialed cross-origin calls only succeed against an origin the backend
// allowlists (CORS_ALLOWED_ORIGINS / APP_ORIGIN); same-origin is unaffected.
//
// The cookie is sent ONLY once GET /api/auth-config resolved `enabled: true`
// (authConfig.ts sets the flag). Before that, or when accounts are off or the
// config failed, requests go out exactly as they did before accounts existed:
// a credentialed request to a backend that has no CORS credentials support
// would otherwise be blocked by the browser.
let credentialsEnabled = false;

export function setCredentialsEnabled(enabled: boolean): void {
  credentialsEnabled = enabled;
}

export function credentialsMode(): RequestCredentials | undefined {
  return credentialsEnabled ? "include" : undefined;
}

export function withCredentials(init?: RequestInit): RequestInit {
  return credentialsEnabled ? { ...init, credentials: "include" } : { ...init };
}

export function apiFetchUrl(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, withCredentials(init));
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return apiFetchUrl(resolveApiUrl(path), init);
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

// Shown as the tooltip/aria-label on the crossed-cloud indicator beside the
// document name while offline. Documents are local-only (no cloud sync), so
// "offline" and "document is local-only" are the same condition here.
export const OFFLINE_DOCUMENT_TITLE =
  "Offline — document is available locally only";
