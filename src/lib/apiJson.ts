// Shared JSON-over-HTTP helpers for the typed backend clients (userSkills,
// agentMemoryApi). Every call goes through `apiFetch` so the credentials rule
// (cookie only after /api/auth-config said accounts are on) holds.

import { apiFetch } from "@/lib/apiBase";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export const JSON_HEADERS = { "Content-Type": "application/json" };

export function withQuery(path: string, query: string): string {
  return query ? `${path}?${query}` : path;
}

/** Never throws: network failures and non-2xx answers become `{ ok: false }`. */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status };
  }

  return { ok: true, data: body as T };
}
