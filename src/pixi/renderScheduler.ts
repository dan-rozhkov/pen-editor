/**
 * Render-on-demand scheduler for the PixiJS application.
 *
 * By default Pixi's TickerPlugin renders the full scene every frame, forever,
 * even when the editor is idle — pure GPU/CPU/battery waste for a design tool
 * whose canvas is static most of the time.
 *
 * This module detaches that unconditional per-frame render and replaces it with
 * a dirty-flag scheduler:
 *   - render whenever something invalidates (any visual store change, marquee
 *     overlay state, font load, canvas/window resize, or an explicit
 *     `requestCanvasRender()` call),
 *   - keep rendering for a trailing window after the last signal (covers drop
 *     animations and debounced re-renders + async rasterization),
 *   - a low-rate safety render as the backstop for purely-async arrivals
 *     (embed rasterization, image loads) that touch no store and emit no signal.
 *
 * Accepted trade-off: a visual change arriving with NO invalidation signal
 * renders at the safety cadence (<= SAFETY_INTERVAL_MS later).
 */
import type { Application } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHoverStore } from "@/store/hoverStore";
import { useDragStore } from "@/store/dragStore";
import { useVariableStore } from "@/store/variableStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useMeasureStore } from "@/store/measureStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useConnectorStore } from "@/store/connectorStore";
import { usePixelGridStore } from "@/store/pixelGridStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useThemeStore } from "@/store/themeStore";
import { subscribeOverlayState } from "./pixiOverlayState";

// Keep rendering this long after the last signal. Covers drop animations
// (~150-300ms), debounced re-renders (120-200ms) plus rasterization latency.
const TRAIL_MS = 1200;
// Backstop cadence for async visual arrivals that emit no invalidation signal.
const SAFETY_INTERVAL_MS = 1000;

let invalidate: (() => void) | null = null;

/**
 * Request a canvas render from anywhere. Used by code paths that mutate Pixi
 * containers directly without going through any store (e.g. the auto-layout
 * drag animator's RAF loops). No-op when no scheduler is installed.
 */
export function requestCanvasRender(): void {
  invalidate?.();
}

export function setupRenderScheduler(app: Application): () => void {
  // Detach Pixi's unconditional per-frame render (registered by TickerPlugin as
  // `ticker.add(app.render, app, UPDATE_PRIORITY.LOW)`).
  app.ticker.remove(app.render, app);

  // Render at least once immediately so the first paint is not delayed.
  let lastActivity = performance.now();
  let lastRender = 0;

  const markActivity = () => {
    lastActivity = performance.now();
  };
  invalidate = markActivity;

  const onTick = () => {
    const now = performance.now();
    if (now - lastActivity <= TRAIL_MS || now - lastRender >= SAFETY_INTERVAL_MS) {
      lastRender = now;
      app.render();
    }
  };
  app.ticker.add(onTick);

  // One subscription per store whose changes imply a visual change, plus the
  // marquee overlay state. Every store's `.subscribe(fn)` and
  // `subscribeOverlayState(fn)` accept a no-arg listener.
  const unsubs: Array<() => void> = [
    useSceneStore.subscribe(markActivity),
    useViewportStore.subscribe(markActivity),
    useSelectionStore.subscribe(markActivity),
    useHoverStore.subscribe(markActivity),
    useDragStore.subscribe(markActivity),
    useVariableStore.subscribe(markActivity),
    useSmartGuideStore.subscribe(markActivity),
    useGuidesStore.subscribe(markActivity),
    useMeasureStore.subscribe(markActivity),
    useDrawModeStore.subscribe(markActivity),
    useConnectorStore.subscribe(markActivity),
    usePixelGridStore.subscribe(markActivity),
    useUIThemeStore.subscribe(markActivity),
    useThemeStore.subscribe(markActivity),
    subscribeOverlayState(markActivity),
  ];

  // Font loads rebuild text/embed containers without writing any store.
  const hasFonts =
    typeof document !== "undefined" && "fonts" in document;
  if (hasFonts) {
    document.fonts.addEventListener("loadingdone", markActivity);
  }

  // Resizing the renderer changes the canvas visually but emits no store signal:
  // (a) window resize, handled by Pixi's ResizePlugin (`resizeTo: container`);
  // (b) container-only resize (e.g. a sidebar collapsing) with no window event.
  const hasWindow = typeof window !== "undefined";
  if (hasWindow) {
    window.addEventListener("resize", markActivity);
  }
  const canvasParent = app.canvas.parentElement;
  const resizeObserver =
    canvasParent && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(markActivity)
      : null;
  resizeObserver?.observe(canvasParent!);

  return () => {
    for (const unsub of unsubs) unsub();
    if (hasFonts) {
      document.fonts.removeEventListener("loadingdone", markActivity);
    }
    if (hasWindow) {
      window.removeEventListener("resize", markActivity);
    }
    resizeObserver?.disconnect();
    app.ticker.remove(onTick);
    invalidate = null;
    // Do NOT re-add app.render — the app is being destroyed.
  };
}
