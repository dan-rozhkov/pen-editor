import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { PwaUpdateGate } from "@/components/pwa/PwaUpdateGate";
import { ShowcasePage } from "@/components/showcase/ShowcasePage";

// The editor pulls in PixiJS and the whole canvas/tool stack; the showcase at
// "/" must never pay that cost. Loading it via `lazy()` behind the "/app"
// route keeps it in its own chunk, separate from the showcase entry bundle.
const EditorApp = lazy(() => import("./App"));

export function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<ShowcasePage />} />
        <Route
          path="/app"
          element={
            <Suspense fallback={null}>
              <EditorApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* "A new version is available" prompt — above the route split so it
          also fires on the showcase at "/", where the editor (its previous
          host) never mounts. Lazy and self-gating; see PwaUpdateGate. */}
      <PwaUpdateGate />
    </BrowserRouter>
  );
}
