import { resolveApiUrl } from "@/lib/apiBase";

// Client for the backend's read-only showcase feed (GET /api/showcase),
// listing screens the AI design agent produced autonomously (no human in the
// loop) for the public showcase at "/". Contract is owned by the backend
// (pen-editor-backend's src/routes/showcase.ts); this module mirrors it.

export interface ShowcaseScreen {
  id: string;
  runId: string;
  theme: string;
  title: string;
  model: string;
  imageUrl: string;
  htmlUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface ShowcasePage {
  screens: ShowcaseScreen[];
  nextCursor: string | null;
}

export type ShowcaseResult =
  | { ok: true; data: ShowcasePage }
  // 503: showcase storage isn't configured on the backend. Rendered
  // identically to an empty list — "nothing generated yet" either way.
  | { ok: false; notConfigured: true }
  | { ok: false; notConfigured: false; error: string };

const DEFAULT_LIMIT = 24;

export function resolveShowcaseApiUrl(
  cursor?: string | null,
  limit: number = DEFAULT_LIMIT,
): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) {
    params.set("cursor", cursor);
  }
  return resolveApiUrl(`/api/showcase?${params.toString()}`);
}

export async function fetchShowcase(
  cursor?: string | null,
  limit: number = DEFAULT_LIMIT,
): Promise<ShowcaseResult> {
  let res: Response;
  try {
    res = await fetch(resolveShowcaseApiUrl(cursor, limit));
  } catch {
    return {
      ok: false,
      notConfigured: false,
      error: "Couldn't reach the server. Check your connection and try again.",
    };
  }

  if (res.status === 503) {
    return { ok: false, notConfigured: true };
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    return { ok: false, notConfigured: false, error: message };
  }

  const data = (await res.json()) as ShowcasePage;
  return { ok: true, data };
}
