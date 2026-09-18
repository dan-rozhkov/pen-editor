import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { ShowcasePage } from "@/components/showcase/ShowcasePage";
import { RouteTracker } from "@/lib/analytics/RouteTracker";
import MobbinCallback from "@/routes/MobbinCallback";

// The editor pulls in PixiJS and the whole canvas/tool stack; the showcase at
// "/" must never pay that cost. Loading it via `lazy()` behind the "/app"
// route keeps it in its own chunk, separate from the showcase entry bundle.
const EditorApp = lazy(() => import("./App"));

// Same reasoning applies to the read-only shared-canvas viewer at "/c/:id" —
// it mounts the editor internally, so it must live in the editor's lazy
// chunk world too, never in the showcase entry bundle.
const SharedCanvasPage = lazy(() => import("./components/share/SharedCanvasPage"));

export function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<ShowcasePage />} />
        {/* Popup-only OAuth callback for connecting Mobbin (mobbinAuth.ts).
            Not lazy — it has no editor/Pixi dependency, so there's no bundle
            cost to keep it in the showcase entry chunk. Must be included in
            the deployed SPA rewrite, same trap /app and /c/:id hit before. */}
        <Route path="/oauth/mobbin/callback" element={<MobbinCallback />} />
        <Route
          path="/app"
          element={
            <Suspense fallback={null}>
              <EditorApp />
            </Suspense>
          }
        />
        <Route
          path="/c/:shareId"
          element={
            <Suspense fallback={null}>
              <SharedCanvasPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* $pageview on every route change, across both the showcase and the
          editor. No-op when analytics is disabled (no VITE_POSTHOG_KEY). */}
      <RouteTracker />
    </BrowserRouter>
  );
}
