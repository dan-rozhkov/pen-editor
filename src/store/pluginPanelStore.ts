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

/** One open plugin panel: the running instance's iframe plus its on-screen
 * position/size. Position/size are viewport (client) pixel coordinates. */
export interface PluginPanelState {
  plugin: PenPlugin;
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

interface PluginPanelStoreState {
  panels: Record<string, PluginPanelState>;
  /** Open (or replace) the panel for a running UI-plugin instance. Initial
   * size comes from `PenPlugin.ui`; position cascades a little so opening
   * several plugins in a row doesn't stack them exactly on top of each other. */
  open: (plugin: PenPlugin, iframe: HTMLIFrameElement) => void;
  close: (pluginId: string) => void;
  resize: (pluginId: string, width: number, height: number) => void;
  move: (pluginId: string, x: number, y: number) => void;
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

    open: (plugin, iframe) =>
      set((state) => {
        const width = plugin.ui?.width ?? DEFAULT_WIDTH;
        const height = plugin.ui?.height ?? DEFAULT_HEIGHT;
        const { width: w, height: h } = clampPanelSize(width, height);
        const offset = (cascadeIndex++ % CASCADE_COUNT) * CASCADE_STEP;
        const { x, y } = clampPositionToViewport(
          { x: CASCADE_BASE + offset, y: CASCADE_BASE + offset },
          { width: w, height: h },
          { width: window.innerWidth, height: window.innerHeight },
        );
        return {
          panels: { ...state.panels, [plugin.id]: { plugin, iframe, x, y, width: w, height: h } },
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
        if (panel.width === w && panel.height === h) return state;
        return { panels: { ...state.panels, [pluginId]: { ...panel, width: w, height: h } } };
      }),

    move: (pluginId, x, y) =>
      set((state) => {
        const panel = state.panels[pluginId];
        if (!panel) return state;
        if (panel.x === x && panel.y === y) return state;
        return { panels: { ...state.panels, [pluginId]: { ...panel, x, y } } };
      }),
  };
});
