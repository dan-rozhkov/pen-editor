import { JSON_HEADERS, requestJson, withQuery, type ApiResult } from "@/lib/apiJson";
import { requestUserIdParam } from "@/lib/auth/authState";

export type MemoryTarget = "memory" | "user";

export interface AgentMemory {
  /** False when the server has no memory store (a normal 200, not an error). */
  available: boolean;
  enabled: boolean;
  memory: string[];
  user: string[];
  limits: { memory: number; user: number };
}

export type MemoryResult<T> = ApiResult<T>;

function request<T>(path: string, init?: RequestInit): Promise<MemoryResult<T>> {
  return requestJson<T>(withQuery(path, requestUserIdParam()), init);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** GET /api/memory */
export async function fetchAgentMemory(): Promise<MemoryResult<AgentMemory>> {
  const res = await request<Partial<AgentMemory>>("/api/memory");
  if (!res.ok) return res;
  const d = res.data ?? {};
  return {
    ok: true,
    data: {
      available: d.available === true,
      enabled: d.enabled !== false,
      memory: strings(d.memory),
      user: strings(d.user),
      limits: { memory: d.limits?.memory ?? 0, user: d.limits?.user ?? 0 },
    },
  };
}

/** DELETE /api/memory/entry — 404 (already gone) is reported as an error with status 404. */
export function deleteMemoryEntry(target: MemoryTarget, text: string): Promise<MemoryResult<{ removed: true }>> {
  return request("/api/memory/entry", {
    method: "DELETE",
    headers: JSON_HEADERS,
    body: JSON.stringify({ target, text }),
  });
}

/** DELETE /api/memory */
export function clearAgentMemory(): Promise<MemoryResult<{ cleared: { memory: number; user: number } }>> {
  return request("/api/memory", { method: "DELETE" });
}

/** PUT /api/memory/settings */
export function setAgentMemoryEnabled(enabled: boolean): Promise<MemoryResult<{ enabled: boolean }>> {
  return request("/api/memory/settings", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  });
}
