import { create } from "zustand";
import { DEFAULT_SURFACE_ID, isSurfaceAvailable, type SurfaceId } from "@/surfaces/meta";

/**
 * Which surface the user asked for in the main work area. Not persisted.
 * This is the REQUEST: whether it is honored right now (mobile, view mode,
 * hidden UI...) is decided in one place, `surfaces/effectiveSurface.ts`; read
 * that, not this, to know what is showing. Distinct from editorModeStore
 * (edit/view/present), which says how the canvas may be used.
 * Asking for a surface that is unavailable here (the browser in the desktop
 * shell) selects the canvas instead.
 *
 * `browserChatId` is the chat whose cloud session the browser surface shows,
 * recorded when the user opens it from that chat's panel. Null means "the
 * active chat" (switcher, palette).
 */
interface SurfaceState {
  activeSurfaceId: SurfaceId;
  browserChatId: string | null;
  setActiveSurface: (id: SurfaceId, opts?: { chatId?: string }) => void;
}

export const useSurfaceStore = create<SurfaceState>((set) => ({
  activeSurfaceId: DEFAULT_SURFACE_ID,
  browserChatId: null,
  setActiveSurface: (id, opts) =>
    set({
      activeSurfaceId: isSurfaceAvailable(id) ? id : DEFAULT_SURFACE_ID,
      browserChatId: id === "browser" ? (opts?.chatId ?? null) : null,
    }),
}));
