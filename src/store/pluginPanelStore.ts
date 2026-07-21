import { create } from "zustand";
import type { PenPlugin } from "@/lib/plugins/types";
import { clampPositionToViewport } from "@/components/ui/popoverDrag";

export const PLUGIN_PANEL_MIN_WIDTH = 240;
export const PLUGIN_PANEL_MIN_HEIGHT = 160;
export const PLUGIN_PANEL_MAX_WIDTH = 1600;
export const PLUGIN_PANEL_MAX_HEIGHT = 1200;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 480;
const CASCADE_STEP = 24;
const CASCADE_COUNT = 6;
const CASCADE_BASE = 96;

/** One open plugin panel: which plugin is running (by id — look up its
 * name/icon live from `pluginStore` so a rename doesn't go stale here) plus
 * the running instance's iframe and its on-screen position/size. Position/
 * size are viewport (client) pixel coordinates. */
export interface PluginPanelState {
  pluginId: string;
  iframe: HTMLIFrameElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampPanelSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(PLUGIN_PANEL_MAX_WIDTH, Math.max(PLUGIN_PANEL_MIN_WIDTH, Math.round(width))),
    height: Math.min(PLUGIN_PANEL_MAX_HEIGHT, Math.max(PLUGIN_PANEL_MIN_HEIGHT, Math.round(height))),
  };
}

/** Shrink a size to fit inside `viewport` (used when the window shrinks
 * below the panel's current footprint), then clamp back up to the sane
 * min — but never past the viewport itself, so a viewport smaller than
 * `PLUGIN_PANEL_MIN_*` still yields an on-screen (if cramped) size rather
 * than one that overflows it. */
export function fitPanelSize(
  width: number,
  height: number,
  viewport: { width: number; height: number },
): { width: number; height: number } {
  const maxWidth = Math.min(PLUGIN_PANEL_MAX_WIDTH, viewport.width);
  const maxHeight = Math.min(PLUGIN_PANEL_MAX_HEIGHT, viewport.height);
  return {
    width: Math.min(maxWidth, Math.max(PLUGIN_PANEL_MIN_WIDTH, Math.round(width))),
    height: Math.min(maxHeight, Math.max(PLUGIN_PANEL_MIN_HEIGHT, Math.round(height))),
  };
}

interface PluginPanelStoreState {
  panels: Record<string, PluginPanelState>;
  /** Open (or reconnect) the panel for a running UI-plugin instance. If a
   * panel for this plugin id is already open (re-running it, e.g. Manager
   * Run), only its iframe is swapped — position/size are left exactly as
   * the user last placed them rather than snapping back to the cascade
   * default. `ui` is `PenPlugin.ui`, used for the initial size on first open;
   * position cascades a little so opening several plugins in a row doesn't
   * stack them exactly on top of each other. */
  open: (pluginId: string, ui: PenPlugin["ui"], iframe: HTMLIFrameElement) => void;
  close: (pluginId: string) => void;
  resize: (pluginId: string, width: number, height: number) => void;
  move: (pluginId: string, x: number, y: number) => void;
  /** Re-fit an open panel to a shrunk viewport (window resize): shrinks size
   * to fit first, then clamps position — shrinking first is what keeps the
   * resize handle (bottom-right corner) from ending up off-screen when only
   * position was being clamped before. */
  fitToViewport: (pluginId: string, viewportWidth: number, viewportHeight: number) => void;
}

/**
 * Open floating plugin panels — pure DOM overlay UI (titlebar + iframe body),
 * never rendered on the PixiJS canvas. Mirrors `pluginStore`'s reasoning for
 * staying out of `renderScheduler.ts`'s `markActivity` allowlist: nothing in
 * here affects canvas rendering, so subscribing there would just be dead
 * work on every open/drag/resize.
 */
export const usePluginPanelStore = create<PluginPanelStoreState>((set) => {
  let cascadeIndex = 0;

  return {
    panels: {},

    open: (pluginId, ui, iframe) =>
      set((state) => {
        const existing = state.panels[pluginId];
        if (existing) {
          // Re-run of an already-open panel: swap the iframe only, keep the
          // geometry the user last set (plg-04 fix — this used to always
          // recompute cascade x/y and reset size from `ui`, snapping a
          // running panel back to its opening position on every Run).
          return { panels: { ...state.panels, [pluginId]: { ...existing, iframe } } };
        }
        const width = ui?.width ?? DEFAULT_WIDTH;
        const height = ui?.height ?? DEFAULT_HEIGHT;
        const { width: w, height: h } = clampPanelSize(width, height);
        const offset = (cascadeIndex++ % CASCADE_COUNT) * CASCADE_STEP;
        const { x, y } = clampPositionToViewport(
          { x: CASCADE_BASE + offset, y: CASCADE_BASE + offset },
          { width: w, height: h },
          { width: window.innerWidth, height: window.innerHeight },
        );
        return {
          panels: { ...state.panels, [pluginId]: { pluginId, iframe, x, y, width: w, height: h } },
        };
      }),

    close: (pluginId) =>
      set((state) => {
        if (!(pluginId in state.panels)) return state;
        const panels = { ...state.panels };
        delete panels[pluginId];
        return { panels };
      }),

    resize: (pluginId, width, height) =>
      set((state) => {
        const panel = state.panels[pluginId];
        if (!panel) return state;
        const { width: w, height: h } = clampPanelSize(width, height);
        // Re-clamp position too: growing the panel at/near a viewport edge
        // (e.g. dragging the bottom-right resize handle) can otherwise push
        // that same handle off-screen, making the panel unreachable/
        // un-shrinkable again.
        const { x, y } = clampPositionToViewport(
          { x: panel.x, y: panel.y },
          { width: w, height: h },
          { width: window.innerWidth, height: window.innerHeight },
        );
        if (panel.width === w && panel.height === h && panel.x === x && panel.y === y) return state;
        return { panels: { ...state.panels, [pluginId]: { ...panel, x, y, width: w, height: h } } };
      }),

    move: (pluginId, x, y) =>
      set((state) => {
        const panel = state.panels[pluginId];
        if (!panel) return state;
        if (panel.x === x && panel.y === y) return state;
        return { panels: { ...state.panels, [pluginId]: { ...panel, x, y } } };
      }),

    fitToViewport: (pluginId, viewportWidth, viewportHeight) =>
      set((state) => {
        const panel = state.panels[pluginId];
        if (!panel) return state;
        const viewport = { width: viewportWidth, height: viewportHeight };
        const { width: w, height: h } = fitPanelSize(panel.width, panel.height, viewport);
        const { x, y } = clampPositionToViewport({ x: panel.x, y: panel.y }, { width: w, height: h }, viewport);
        if (panel.width === w && panel.height === h && panel.x === x && panel.y === y) return state;
        return { panels: { ...state.panels, [pluginId]: { ...panel, x, y, width: w, height: h } } };
      }),
  };
});
