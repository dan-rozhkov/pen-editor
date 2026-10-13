import { createHttpBackend } from "@sideform/browser-agent/adapters/http-backend";
import { apiFetch } from "@/lib/apiBase";

/**
 * The one `/api/browse/{step,plan,locate}` transport for browse_task and
 * browse_act's `element` lookup. Every request goes through `apiFetch`, as
 * before: base URL resolved per request and the session cookie sent only once
 * accounts are on.
 */
export const browseBackend = createHttpBackend({
  baseUrl: "",
  fetch: (path, init) => apiFetch(String(path), init),
});
