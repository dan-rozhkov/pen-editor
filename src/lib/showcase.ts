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

export type ShowcasePlatform = "mobile" | "desktop";

/** One app: every screen of a single generation run, cover first. */
export interface ShowcaseApp {
  runId: string;
  theme: string;
  model: string;
  createdAt: string;
  likes: number;
  // Optional: no component actually reads an app's own `platform` field —
  // ShowcasePage derives the platform it's displaying from the `?platform=`
  // URL param (a request-level filter), not from data on individual apps.
  // Kept optional rather than removed since the frontend and backend deploy
  // independently and an older/newer backend may or may not send it.
  platform?: ShowcasePlatform;
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
  platform?: ShowcasePlatform;
  model?: string | null;
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
  if (filters?.model) {
    params.set("model", filters.model);
  }
  // Unlike sort/category (omitted at their default so the request URL
  // doesn't change gratuitously), platform is always sent explicitly. The
  // backend's own default is "mobile" too, so this is redundant on the
  // common path — but an explicit param can't silently drift from the
  // backend's default if that default ever changes, and every caller here
  // already knows which platform it wants (ShowcasePage always has one from
  // the URL/parsePlatform), so there's no "caller doesn't care" case to
  // optimize for.
  params.set("platform", filters?.platform ?? "mobile");
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

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return {
      ok: false,
      notConfigured: false,
      error: STALE_CLIENT_ERROR,
    };
  }

  const data = parseShowcasePage(raw);
  if (!data) {
    return {
      ok: false,
      notConfigured: false,
      error: STALE_CLIENT_ERROR,
    };
  }
  return { ok: true, data };
}

// Both repos deploy independently, and a visitor's browser can still be
// holding an old cached bundle against a newer backend (this is exactly how
// a prior outage happened: a stale client crashed on a response shape the
// backend had since changed). A response shape this client doesn't
// recognize is the signature of that same skew, so the error nudges toward
// the fix that actually works (reload to pick up the matching bundle)
// rather than a generic "something broke".
const STALE_CLIENT_ERROR =
  "The showcase feed returned data this page doesn't recognize — try reloading the page to get the latest version.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Validates exactly the fields the render path dereferences unconditionally
// (array .length/.map, array indexing, string interpolation used as a DOM
// attribute) — not the full response shape. Anything genuinely optional
// (`platform`, `lqip`, `imageUrl1x`, screen `createdAt` used only inside
// coercing contexts) is intentionally left unchecked, so the next backend
// field addition doesn't turn into another outage here.
//
// Invalid *apps*/*screens* are dropped rather than failing the whole page:
// ShowcasePage already renders a shorter (or empty) grid gracefully, so one
// malformed row shouldn't blank the rest of a page that mostly parsed fine.
// The response is only rejected outright when the top-level envelope itself
// doesn't match (missing/wrong-typed `apps`, e.g. the old `{screens: [...]}`
// shape) — that's not "one bad row", it's "this isn't the shape we speak".
function parseShowcasePage(raw: unknown): ShowcasePage | null {
  if (!isRecord(raw) || !Array.isArray(raw.apps)) {
    return null;
  }

  const apps: ShowcaseApp[] = [];
  for (const candidate of raw.apps) {
    const app = parseShowcaseApp(candidate);
    if (app) {
      apps.push(app);
    }
  }

  const nextCursor = typeof raw.nextCursor === "string" ? raw.nextCursor : null;
  return { apps, nextCursor };
}

function parseShowcaseApp(raw: unknown): ShowcaseApp | null {
  if (!isRecord(raw) || typeof raw.runId !== "string" || raw.runId.length === 0) {
    // Unconditional (not import.meta.env.DEV-gated): this is the one signal
    // that a backend field rename silently emptied the showcase, and that
    // class of bug shows up in production deploys, not dev sessions — the
    // frontend and backend here deploy independently (see the module
    // comment), so this is diagnostic for prod, not noise to gate out of it.
    console.warn(
      "[showcase] dropping app: missing or invalid runId",
      isRecord(raw) ? raw.runId : raw,
    );
    return null;
  }
  if (!Array.isArray(raw.screens)) {
    console.warn(`[showcase] dropping app ${raw.runId}: screens is not an array`);
    return null;
  }

  const screens: ShowcaseScreen[] = [];
  for (const candidate of raw.screens) {
    const screen = parseShowcaseScreen(candidate);
    if (screen) {
      screens.push(screen);
    }
  }
  // ShowcaseAppCarousel reads `app.screens[0]` unconditionally (the cover
  // screen) — an app with zero surviving screens would crash exactly the
  // same way the malformed response it's guarding against does.
  if (screens.length === 0) {
    console.warn(`[showcase] dropping app ${raw.runId}: no valid screens survived parsing`);
    return null;
  }

  return {
    runId: raw.runId,
    theme: typeof raw.theme === "string" ? raw.theme : "",
    model: typeof raw.model === "string" ? raw.model : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    likes: typeof raw.likes === "number" ? raw.likes : 0,
    platform: raw.platform === "mobile" || raw.platform === "desktop" ? raw.platform : undefined,
    screens,
  };
}

function parseShowcaseScreen(raw: unknown): ShowcaseScreen | null {
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    typeof raw.title !== "string" ||
    typeof raw.imageUrl !== "string" ||
    raw.imageUrl.length === 0 ||
    typeof raw.width !== "number" ||
    typeof raw.height !== "number"
  ) {
    console.warn(
      "[showcase] dropping screen: missing/invalid required field",
      isRecord(raw) && typeof raw.id === "string" ? raw.id : raw,
    );
    return null;
  }

  return {
    id: raw.id,
    title: raw.title,
    imageUrl: raw.imageUrl,
    imageUrl1x: typeof raw.imageUrl1x === "string" ? raw.imageUrl1x : undefined,
    lqip: typeof raw.lqip === "string" ? raw.lqip : undefined,
    htmlUrl: typeof raw.htmlUrl === "string" ? raw.htmlUrl : "",
    width: raw.width,
    height: raw.height,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
  };
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
 * app count descending. The set of themes differs per platform (mobile and
 * desktop apps aren't necessarily generated from the same theme list), so
 * callers must re-fetch whenever the platform changes rather than reusing a
 * mount-time snapshot. A failure (network, 503, non-2xx) resolves to
 * `{ ok: false }` rather than throwing: ShowcaseFilterBar's spec is to just
 * not render the chip row when this comes back empty, same as an empty list.
 */
export async function fetchShowcaseCategories(
  platform: ShowcasePlatform = "mobile",
): Promise<ShowcaseCategoriesResult> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(`/api/showcase/categories?platform=${platform}`));
  } catch {
    return { ok: false };
  }
  if (!res.ok) {
    return { ok: false };
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false };
  }
  if (!isRecord(raw) || !Array.isArray(raw.categories)) {
    return { ok: false };
  }

  const categories: ShowcaseCategory[] = [];
  for (const candidate of raw.categories) {
    if (isRecord(candidate) && typeof candidate.theme === "string") {
      categories.push({
        theme: candidate.theme,
        apps: typeof candidate.apps === "number" ? candidate.apps : 0,
      });
    }
  }
  return { ok: true, categories };
}

export interface ShowcaseModel {
  model: string;
  apps: number;
}

export type ShowcaseModelsResult =
  | { ok: true; models: ShowcaseModel[] }
  | { ok: false };

/**
 * GET /api/showcase/models — model ids present in the database, ordered by
 * app count descending. Mirrors `fetchShowcaseCategories` exactly: the model
 * set differs per platform, so callers must re-fetch on platform change, and
 * a failure (network, non-2xx, malformed body) resolves to `{ ok: false }`
 * rather than throwing — ShowcaseFilterBar's spec is to just not render the
 * model select when this comes back empty, same as an empty list.
 */
export async function fetchShowcaseModels(
  platform: ShowcasePlatform = "mobile",
): Promise<ShowcaseModelsResult> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(`/api/showcase/models?platform=${platform}`));
  } catch {
    return { ok: false };
  }
  if (!res.ok) {
    return { ok: false };
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false };
  }
  if (!isRecord(raw) || !Array.isArray(raw.models)) {
    return { ok: false };
  }

  const models: ShowcaseModel[] = [];
  for (const candidate of raw.models) {
    if (isRecord(candidate) && typeof candidate.model === "string") {
      models.push({
        model: candidate.model,
        apps: typeof candidate.apps === "number" ? candidate.apps : 0,
      });
    }
  }
  return { ok: true, models };
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
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false };
  }
  if (!isRecord(raw) || typeof raw.likes !== "number") {
    return { ok: false };
  }
  return { ok: true, likes: raw.likes };
}
