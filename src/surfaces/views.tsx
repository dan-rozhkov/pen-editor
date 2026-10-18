import { lazy, Suspense, type ComponentType } from "react";
import type { SurfaceId } from "./meta";

/**
 * Main-area Views, attached by surface id and loaded lazily. Used by App and
 * nothing else; kept out of `./meta` so the embed graph (which reads the
 * surface store) never pulls in chat or cloud-browser code. The canvas has no
 * entry: it is always mounted behind the UI.
 */
const VIEWS: Partial<Record<SurfaceId, ComponentType>> = {
  browser: lazy(() =>
    import("@/components/surfaces/BrowserSurfaceView").then((m) => ({ default: m.BrowserSurfaceView })),
  ),
};

/** Renders the View of `id` (nothing for the canvas) while its chunk loads or after. */
export function SurfaceViewHost({ id }: { id: SurfaceId }) {
  const View = VIEWS[id];
  return View ? (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  ) : null;
}
