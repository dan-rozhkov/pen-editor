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
  likes: number;
  screens: ShowcaseScreen[];
}

export interface ShowcasePage {
  apps: ShowcaseApp[];
  nextCursor: string | null;
}

export type ShowcaseSort = "popular" | "latest";

export interface ShowcaseFilters {
  sort?: ShowcaseSort;
  category?: string | null;
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
  filters?: ShowcaseFilters,
): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) {
    params.set("cursor", cursor);
  }
  if (filters?.sort) {
    params.set("sort", filters.sort);
  }
  if (filters?.category) {
    params.set("category", filters.category);
  }
  return resolveApiUrl(`/api/showcase?${params.toString()}`);
}

export async function fetchShowcase(
  cursor?: string | null,
  limit: number = DEFAULT_LIMIT,
  filters?: ShowcaseFilters,
): Promise<ShowcaseResult> {
  let res: Response;
  try {
    res = await fetch(resolveShowcaseApiUrl(cursor, limit, filters));
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

export interface ShowcaseCategory {
  theme: string;
  apps: number;
}

export type ShowcaseCategoriesResult =
  | { ok: true; categories: ShowcaseCategory[] }
  | { ok: false };

/**
 * GET /api/showcase/categories — themes present in the database, ordered by
 * app count descending. A failure (network, 503, non-2xx) resolves to
 * `{ ok: false }` rather than throwing: ShowcaseFilterBar's spec is to just
 * not render the chip row when this comes back empty, same as an empty list.
 */
export async function fetchShowcaseCategories(): Promise<ShowcaseCategoriesResult> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/showcase/categories"));
  } catch {
    return { ok: false };
  }
  if (!res.ok) {
    return { ok: false };
  }
  try {
    const data = (await res.json()) as { categories: ShowcaseCategory[] };
    return { ok: true, categories: data.categories ?? [] };
  } catch {
    return { ok: false };
  }
}

export type LikeShowcaseAppResult =
  | { ok: true; likes: number }
  | { ok: false };

/**
 * POST /api/showcase/:runId/like — increments the app's like counter by
 * `count` (1..25, enforced server-side) and returns the new total. Errors
 * (network, non-2xx) resolve to `{ ok: false }` so the caller (useShowcaseLikes)
 * can roll back its optimistic delta without throwing across a debounce timer.
 */
export async function likeShowcaseApp(
  runId: string,
  count: number,
): Promise<LikeShowcaseAppResult> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(`/api/showcase/${encodeURIComponent(runId)}/like`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count }),
      // The body is a couple bytes, well inside the keepalive limit — this is
      // what lets the flush-on-visibilitychange/unmount calls in
      // useShowcaseLikes actually reach the server instead of being cut off
      // by the browser the instant the tab closes (a plain `fetch` is
      // aborted on page unload). GET requests elsewhere in this file don't
      // need it — they aren't racing the page going away.
      keepalive: true,
    });
  } catch {
    return { ok: false };
  }
  if (!res.ok) {
    return { ok: false };
  }
  try {
    const data = (await res.json()) as { likes: number };
    return { ok: true, likes: data.likes };
  } catch {
    return { ok: false };
  }
}
