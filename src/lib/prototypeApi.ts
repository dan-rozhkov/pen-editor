import type { PrototypeScreenInput, PrototypeLink } from "@/utils/prototype/types";
import { resolveApiUrl } from "@/lib/apiBase";

/** Resolve the `/api/prototype-link` endpoint on the same backend the chat
 * hook talks to (`resolveApiUrl` centralizes the `VITE_AI_API_URL` /
 * `VITE_DESIGN_AGENT_BACKEND_URL` / same-origin resolution used by
 * `useDesignChat`). */
export function resolvePrototypeApiUrl(): string {
  return resolveApiUrl("/api/prototype-link");
}

export async function fetchPrototypeLinks(
  screens: PrototypeScreenInput[],
): Promise<PrototypeLink[]> {
  const res = await fetch(resolvePrototypeApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screens }),
  });
  if (!res.ok) throw new Error(`prototype-link failed: ${res.status}`);
  const data = (await res.json()) as { links: PrototypeLink[] };
  return data.links ?? [];
}
