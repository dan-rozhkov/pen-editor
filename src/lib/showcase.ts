import { resolveApiUrl } from "@/lib/apiBase";

// Client for the backend's read-only showcase feed (GET /api/showcase),
// listing apps the AI design agent produced autonomously (no human in the
// loop) for the public showcase at "/". Contract is owned by the backend
// (pen-editor-backend's src/routes/showcase.ts); this module mirrors it.
//
// The feed paginates by *app*, not by screen: the gallery renders one card
// per app, and a page measured in screens used to cut an app in half at the
// boundary — its carousel silently grew when the visitor clicked "Show more".

export interface ShowcaseScreen {
  id: string;
  title: string;
  imageUrl: string;
  // Optional: absent on rows published before the WebP-derivatives backfill
  // (see pen-editor-backend docs/superpowers/specs/2026-07-28-showcase-image-delivery-design.md).
  // A screen missing them just renders the plain `imageUrl` as before.
  imageUrl1x?: string;
  lqip?: string;
  htmlUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

/** One app: every screen of a single generation run, cover first. */
export interface ShowcaseApp {
  runId: string;
  theme: string;
  model: string;
  createdAt: string;
  screens: ShowcaseScreen[];
}

export interface ShowcasePage {
  apps: ShowcaseApp[];
  nextCursor: string | null;
}

export type ShowcaseResult =
  | { ok: true; data: ShowcasePage }
  // 503: showcase storage isn't configured on the backend. Rendered
  // identically to an empty list — "nothing generated yet" either way.
  | { ok: false; notConfigured: true }
  | { ok: false; notConfigured: false; error: string };

// Apps per page, not screens — 12 fills three rows of the four-column grid.
const DEFAULT_LIMIT = 12;

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
