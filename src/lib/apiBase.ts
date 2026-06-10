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
