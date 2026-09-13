import { create } from "zustand";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";
import { truncateOuterHtml } from "@/lib/embedElementPicker";

interface EmbedPickerState {
  /** The embed node id currently in "select element" mode, or null. */
  pickingEmbedId: string | null;
  /** CSS path (relative to that embed's content root) of the element under
   * the pointer while picking. */
  hoveredPath: string | null;
  /** The last element the user clicked while picking. Survives `stopPicking`
   * — the whole point is that the agent still knows what was pointed at. */
  selection: EmbedElementSelection | null;
  /** The owning embed's `htmlContent` captured at the moment `selection` was
   * picked, so a later scene change can tell the pick is stale (the embed's
   * HTML was edited since — e.g. via `edit_embed_html` — so both `outerHtml`
   * and the positional `nth-of-type` `path` may no longer describe the same
   * element). Deliberately a sibling field, NOT part of
   * `EmbedElementSelection` — that object is spread verbatim into
   * `canvasContext` (see `buildCanvasContext` in `useDesignChat.ts`), and a
   * full HTML snapshot has no business going over the wire there. */
  selectionHtmlSnapshot: string | null;

  startPicking: (embedId: string) => void;
  stopPicking: () => void;
  setHoveredPath: (path: string | null) => void;
  /** `htmlAtPick` is optional only for callers (and older tests) that don't
   * care about staleness invalidation; omitting it means the selection is
   * never cleared on an html change. */
  selectElement: (selection: EmbedElementSelection, htmlAtPick?: string) => void;
  clearSelection: () => void;
  /** Called right BEFORE writing an element edit made from the properties
   * panel into the scene, so the lifecycle check doesn't read it as a
   * foreign html change and drop the selection. `outerHtml` refreshes the
   * preview handed to the agent (see `describeEmbedElement`/
   * `OUTER_HTML_MAX` in `embedElementPicker.ts`). No-op when there is no
   * selection. */
  noteSelectionEdit: (html: string, outerHtml?: string) => void;
  reset: () => void;
}

export const useEmbedPickerStore = create<EmbedPickerState>((set, get) => ({
  pickingEmbedId: null,
  hoveredPath: null,
  selection: null,
  selectionHtmlSnapshot: null,

  startPicking: (embedId) => {
    const { selection } = get();
    const staysForThisEmbed = selection && selection.embedId === embedId;
    set({
      pickingEmbedId: embedId,
      hoveredPath: null,
      // A selection belonging to a different embed is stale once picking
      // starts on this one — clear it so a leftover selection from another
      // embed doesn't get sent to the agent alongside a fresh pick.
      selection: staysForThisEmbed ? selection : null,
      selectionHtmlSnapshot: staysForThisEmbed ? get().selectionHtmlSnapshot : null,
    });
  },

  stopPicking: () => set({ pickingEmbedId: null, hoveredPath: null }),

  setHoveredPath: (path) => set({ hoveredPath: path }),

  selectElement: (selection, htmlAtPick) =>
    set({ selection, selectionHtmlSnapshot: htmlAtPick ?? null }),

  clearSelection: () => set({ selection: null, selectionHtmlSnapshot: null }),

  noteSelectionEdit: (html, outerHtml) => {
    const { selection } = get();
    if (!selection) return;
    set({
      selectionHtmlSnapshot: html,
      selection:
        outerHtml !== undefined
          ? { ...selection, outerHtml: truncateOuterHtml(outerHtml) }
          : selection,
    });
  },

  reset: () =>
    set({ pickingEmbedId: null, hoveredPath: null, selection: null, selectionHtmlSnapshot: null }),
}));
