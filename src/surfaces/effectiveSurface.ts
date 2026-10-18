import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { isMobileViewport, useIsMobile } from "@/hooks/useIsMobile";
import { DEFAULT_SURFACE_ID, isSurfaceAvailable, type SurfaceId } from "./meta";

/**
 * THE answer to "which surface is really showing". The store holds what the
 * user asked for; this applies the conditions under which switching is not
 * offered at all: mobile (no center area), view/dev/present mode, the
 * read-only shared viewer, and hidden UI (the surface's View lives inside the
 * UI layer). Every consumer (App, keyboard and clipboard handlers, palette
 * commands, CloudBrowserPanel) goes through here, so they cannot disagree.
 *
 * Imports stores and `./meta` only (no views, no chat), so it is safe in the
 * embed graph.
 */
interface SwitchConditions {
  mobile: boolean;
  mode: string;
  dev: boolean;
  shared: boolean;
  uiHidden: boolean;
}

function switchAllowed(c: SwitchConditions): boolean {
  return !c.mobile && c.mode === "edit" && !c.dev && !c.shared && !c.uiHidden;
}

function resolve(c: SwitchConditions, requested: SurfaceId): SurfaceId {
  return switchAllowed(c) && isSurfaceAvailable(requested) ? requested : DEFAULT_SURFACE_ID;
}

function readConditions(): SwitchConditions {
  return {
    mobile: isMobileViewport(),
    mode: useEditorModeStore.getState().mode,
    dev: useDevModeStore.getState().active,
    shared: useSharedViewStore.getState().isSharedView,
    uiHidden: useUIVisibilityStore.getState().isUIHidden,
  };
}

/** True when the user can pick a non-canvas surface right now. */
export function canSwitchSurfaces(): boolean {
  return switchAllowed(readConditions());
}

export function getEffectiveSurfaceId(): SurfaceId {
  return resolve(readConditions(), useSurfaceStore.getState().activeSurfaceId);
}

/**
 * True when the canvas is the surface in view, so canvas input (shortcuts,
 * clipboard, palette edit commands, window-level key listeners) may act on it.
 * Gate ANY new canvas input handler on this.
 */
export function isCanvasInputActive(): boolean {
  return getEffectiveSurfaceId() === DEFAULT_SURFACE_ID;
}

function useConditions(): SwitchConditions {
  const mobile = useIsMobile();
  const mode = useEditorModeStore((s) => s.mode);
  const dev = useDevModeStore((s) => s.active);
  const shared = useSharedViewStore((s) => s.isSharedView);
  const uiHidden = useUIVisibilityStore((s) => s.isUIHidden);
  return { mobile, mode, dev, shared, uiHidden };
}

/** React twin of `canSwitchSurfaces`. */
export function useCanSwitchSurfaces(): boolean {
  return switchAllowed(useConditions());
}

/** React twin of `getEffectiveSurfaceId`. */
export function useEffectiveSurfaceId(): SurfaceId {
  const conditions = useConditions();
  const requested = useSurfaceStore((s) => s.activeSurfaceId);
  return resolve(conditions, requested);
}
