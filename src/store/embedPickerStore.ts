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
  /** Monotonic counter bumped on every frame of an in-progress element drag
   * inside an embed. A drag mutates the live shadow-DOM element's inline
   * style directly and only commits to `htmlContent` on pointerup, so none
   * of the signals `EmbedElementHighlight` normally re-renders on
   * (viewportStore, layoutStore, the shadow `scroll` listener, the content
   * ResizeObserver) ever fire during the gesture — without this tick the
   * outline and the size badge would sit at the element's pre-drag box for
   * the whole drag. */
  dragVersion: number;
  /** Cancels the element drag currently in flight inside an embed, reverting
   * the live element without writing anything to the scene — or `null` when
   * no drag has crossed the drag threshold. Registered by `EmbedLayer`'s
   * drag gesture and called by the global Escape handler
   * (`keyboardCommands.ts`), exactly like `useDragStore.cancelDrag` for a
   * native-node drag.
   *
   * Deliberately a store-registered callback rather than a
   * `stopImmediatePropagation()` from a capture-phase `keydown` listener of
   * our own: capture listeners bound to the SAME target (`window`) run in
   * registration order, and the global canvas handler is registered at app
   * mount — long before picking ever starts — so it always wins the race and
   * would have already run `exitContainer()`/`stopPicking()` (dropping the
   * user out of the picker entirely) before our listener could consume the
   * event. Caught live by `e2e/embed-element-drag.spec.ts`. */
  cancelElementDrag: (() => void) | null;

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
  bumpDragVersion: () => void;
  setCancelElementDrag: (cancel: (() => void) | null) => void;
  reset: () => void;
}

export const useEmbedPickerStore = create<EmbedPickerState>((set, get) => ({
  pickingEmbedId: null,
  hoveredPath: null,
  selection: null,
  selectionHtmlSnapshot: null,
  dragVersion: 0,
  cancelElementDrag: null,

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

  bumpDragVersion: () => set((s) => ({ dragVersion: s.dragVersion + 1 })),

  setCancelElementDrag: (cancel) => set({ cancelElementDrag: cancel }),

  reset: () =>
    set({
      pickingEmbedId: null,
      hoveredPath: null,
      selection: null,
      selectionHtmlSnapshot: null,
      cancelElementDrag: null,
    }),
}));
