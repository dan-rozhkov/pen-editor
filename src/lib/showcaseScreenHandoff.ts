// "Open in Editor" handoff for one showcase app's screens (FIR-62) — the
// showcase (route "/") to editor (route "/app") counterpart of
// showcaseAgentHandoff.ts, and deliberately as small: AppRouter lazy-loads
// the editor precisely so the showcase entry chunk never pulls in Pixi/the
// scene stores (see AppRouter.tsx), so this module must stay free of any
// store/Pixi import — it is imported from showcase code (ShowcaseAppCarousel)
// as well as editor code (importShowcaseScreens.ts).
//
// The payload does NOT carry the HTML itself, or even where to fetch it
// (`htmlUrl`) or its dimensions: `importShowcaseScreens.ts` only ever reads
// `handoff.runId` — it calls the backend's `GET /api/showcase/:runId/html`,
// which looks up that run's *own*, already-known, already-ordered screens
// straight from Postgres (`store.getAppScreens`) rather than trusting
// anything from this payload. (That route exists at all because a plain
// browser `fetch(htmlUrl)` fails: the S3 bucket serving those objects has no
// `Access-Control-Allow-Origin` header, verified against the live bucket
// 2026-07-29, so a same-origin editor tab fetching a cross-origin S3 URL is
// blocked by CORS before it ever sees a body.) `screens` here is kept only as
// a per-screen id/title list so `storeShowcaseScreensHandoff` can reject an
// app with nothing to hand off — an earlier version also carried
// `htmlUrl`/`width`/`height` per screen, dead weight once the fetch moved
// server-side entirely.
const SHOWCASE_SCREENS_KEY = "pen:showcase-editor-screens:v1";

export interface ShowcaseHandoffScreen {
  id: string;
  title: string;
}

export interface ShowcaseScreensHandoff {
  runId: string;
  screens: ShowcaseHandoffScreen[];
}

/** Called from the showcase when "Open in Editor" is clicked. */
export function storeShowcaseScreensHandoff(
  payload: ShowcaseScreensHandoff,
): boolean {
  if (!payload.runId || payload.screens.length === 0) return false;

  try {
    sessionStorage.setItem(SHOWCASE_SCREENS_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Called once from the editor on mount. Removes the payload as it reads it
 * (one-shot), so a reload of `/app` never re-imports the same screens.
 */
export function consumeShowcaseScreensHandoff(): ShowcaseScreensHandoff | null {
  try {
    const raw = sessionStorage.getItem(SHOWCASE_SCREENS_KEY);
    sessionStorage.removeItem(SHOWCASE_SCREENS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ShowcaseScreensHandoff> | null;
    if (!parsed?.runId || !Array.isArray(parsed.screens) || parsed.screens.length === 0) {
      return null;
    }
    return { runId: parsed.runId, screens: parsed.screens };
  } catch {
    return null;
  }
}
