import { create } from "zustand";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";
import { truncateOuterHtml } from "@/lib/embedElementPicker";

interface EmbedPickerState {
  /** The embed node id currently in "select element" mode, or null. */
  pickingEmbedId: string | null;
  /** CSS path (relative to that embed's content root) of the element under
   * the pointer while picking, OR the element the pointer is over in the
   * layers panel (see `hoveredEmbedId`). */
  hoveredPath: string | null;
  /** The embed `hoveredPath` resolves against when it comes from a layers
   * panel row hover rather than the canvas picker — the picker case always
   * resolves `hoveredPath` against `pickingEmbedId` instead (see
   * `EmbedElementHighlight`'s `pickingEmbedId ?? hoveredEmbedId`), so this
   * field only matters while `pickingEmbedId` is null. Kept as a separate
   * field rather than repurposing `pickingEmbedId` itself: hovering a row in
   * the panel must NOT put the app into "select element" mode. */
  hoveredEmbedId: string | null;
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
   * event. Caught live by `e2e/embed-element-sortable.spec.ts`. */
  cancelElementDrag: (() => void) | null;
  /** Cancels the single-element inline TEXT edit currently in flight inside
   * an embed, reverting the live element and writing nothing to the scene —
   * or `null` when no edit is in progress. Registered by `EmbedLayer`'s
   * `beginElementEdit` and called by the global Escape handler
   * (`keyboardCommands.ts`), exactly mirroring `cancelElementDrag` right
   * above (same field, same contract, same reason it has to be a
   * store-registered callback rather than something the edit's own
   * `keydown` listener can win by registration order): a capture-phase
   * `keydown` listener on `window` always runs before one on a descendant
   * target, `el` included — `window` is the topmost node visited in the
   * capture phase, and that ordering has nothing to do with WHEN either
   * listener was registered. Without this, the global handler's Escape
   * branch reaches `exitContainer()` first, which sees this edit's picker
   * `selection` (set on entry, in `beginElementEdit`) as leftover state to
   * clear — silently dropping the element selection (and the properties
   * panel jumping back to the embed) on every Escape-cancelled text edit,
   * even though the edit itself reverted correctly via `el`'s own listener. */
  cancelElementEdit: (() => void) | null;
  /** Starts the SAME inline text edit `EmbedLayer`'s dblclick handler starts
   * (`beginElementEdit`), but from a shadow-relative `path` rather than a
   * live pointer target — the entry point for keyboard navigation's Enter
   * key. Returns whether the edit actually started: `false` when `path`
   * doesn't resolve to a live element in the embed's current shadow DOM, or
   * resolves to one that isn't a text leaf (`isTextLeaf`), so the caller
   * (`keyboardCommands.ts`) knows not to treat Enter as consumed. `null`
   * while no embed is picking — there is no live shadow DOM/edit session to
   * hand the request to.
   *
   * Store-registered for the same reason as `cancelElementDrag`/
   * `cancelElementEdit` right above: the global keyboard handler is a
   * capture-phase `window` listener wired up once at app mount, with no way
   * to reach into `EmbedLayer`'s per-embed picking effect — where
   * `beginElementEdit` actually lives, closing over the live shadow root
   * and the element's edit-session state — except through a callback that
   * effect hands the store itself. */
  requestElementEdit: ((path: string) => boolean) | null;
  /** The insertion-line rect for the sortable drag currently in flight (see
   * `embedElementSortable.ts`'s `DropSlot.indicator`), in CLIENT
   * coordinates — `null` whenever no drag is in progress or the pointer
   * isn't currently over any drop slot. `EmbedElementHighlight` reads this
   * to draw the line; `EmbedLayer`'s drag gesture is the only writer. */
  dropIndicator: { left: number; top: number; width: number; height: number } | null;
  /** The embed a dblclicked text leaf is currently being inline-edited in,
   * or null. A separate pair of fields rather than reusing `pickingEmbedId`
   * itself: picking (hover/click/drag) stays active for the REST of the
   * embed while one element is being typed into.
   *
   * `EmbedLayer`'s own picking effect does NOT read these — it suppresses
   * hover-highlighting and drag-start for the editing element via a plain
   * local closure variable (`edit`) it already has for free, since it's the
   * one that started the edit. What genuinely needs these is
   * `EmbedElementHighlight`: a separate component with no access to that
   * closure, which uses them to withhold the SELECTION outline + size badge
   * for the element currently being typed into — without this, that box
   * would sit drawn on top of the live caret for the whole edit. Kept in
   * the store (not a local ref in `EmbedLayer`) so it's independently
   * readable by tests and so a picker-lifecycle reset (`reset`/
   * `stopPicking`) can't leave editing-mode flags dangling once the picker
   * itself goes away. */
  editingEmbedId: string | null;
  /** Shadow-relative path (see `buildElementPath`) of the element currently
   * being inline-edited, paired with `editingEmbedId`. */
  editingPath: string | null;

  startPicking: (embedId: string) => void;
  stopPicking: () => void;
  setHoveredPath: (path: string | null) => void;
  /** Sets `hoveredEmbedId`/`hoveredPath` together — used by the layers panel
   * row hover (`LayerItem`'s embed-element branch), as opposed to
   * `setHoveredPath` alone, which the canvas picker (`EmbedLayer`) uses
   * while `pickingEmbedId` already names the embed. */
  setHoveredElement: (embedId: string | null, path: string | null) => void;
  /** `htmlAtPick` is optional only for callers (and older tests) that don't
   * care about staleness invalidation; omitting it means the selection is
   * never cleared on an html change. */
  selectElement: (selection: EmbedElementSelection, htmlAtPick?: string) => void;
  clearSelection: () => void;
  /** Called right BEFORE writing an element edit made from the properties
   * panel — or a sortable reorder — into the scene, so the lifecycle check
   * doesn't read it as a foreign html change and drop the selection.
   * `outerHtml` refreshes the preview handed to the agent (see
   * `describeEmbedElement`/`OUTER_HTML_MAX` in `embedElementPicker.ts`).
   * `newPath` updates `selection.path`: after a reorder the element's
   * `nth-of-type` position among its siblings changes, so the OLD path
   * would resolve to whatever now sits in the element's former slot rather
   * than the element itself — every subsequent hover/highlight/edit call
   * would silently target the wrong node without this. No-op when there is
   * no selection. */
  noteSelectionEdit: (html: string, outerHtml?: string, newPath?: string) => void;
  bumpDragVersion: () => void;
  setCancelElementDrag: (cancel: (() => void) | null) => void;
  /** Registers/clears `cancelElementEdit` — see that field's own doc comment. */
  setCancelElementEdit: (cancel: (() => void) | null) => void;
  /** Registers/clears `requestElementEdit` — see that field's own doc comment. */
  setRequestElementEdit: (request: ((path: string) => boolean) | null) => void;
  setDropIndicator: (
    indicator: { left: number; top: number; width: number; height: number } | null,
  ) => void;
  /** True exactly while `EmbedElementHighlight` has the element-scoped agent
   * affordance mounted — i.e. it resolved the picked element to a live box
   * and drew a button for it. `PixiCanvas` reads this to decide whether to
   * suppress the embed-level "Ask agent" button, which it replaces.
   *
   * A store flag rather than the presence of `selection`, because the two
   * can disagree: the element can vanish from the embed's live shadow DOM
   * with `htmlContent` untouched (the embed's own script rotating a carousel
   * slide out, closing a modal, …), and nothing clears the selection then.
   * Suppressing on `selection` alone left such an embed with no agent
   * affordance at all. Written by the affordance's own mount/unmount, so it
   * cannot claim a button that isn't there; if it is ever stale it errs
   * toward `false`, i.e. toward showing the embed-level button. */
  elementAffordanceVisible: boolean;
  setElementAffordanceVisible: (visible: boolean) => void;
  /** Enters single-element inline text editing — see `editingEmbedId`'s doc
   * comment. Called by `EmbedLayer`'s dblclick handler once it has resolved
   * a text-leaf target and made it contenteditable. */
  startElementEdit: (embedId: string, path: string) => void;
  /** Leaves single-element inline text editing, on commit, on Escape
   * revert, or on effect teardown (isPicking flips off mid-edit). Does NOT
   * touch `selection`/`pickingEmbedId` — those are the picker's own
   * concerns and outlive one element's edit session. */
  stopElementEdit: () => void;
  reset: () => void;
}

export const useEmbedPickerStore = create<EmbedPickerState>((set, get) => ({
  pickingEmbedId: null,
  hoveredPath: null,
  hoveredEmbedId: null,
  selection: null,
  selectionHtmlSnapshot: null,
  dragVersion: 0,
  cancelElementDrag: null,
  cancelElementEdit: null,
  requestElementEdit: null,
  dropIndicator: null,
  elementAffordanceVisible: false,
  editingEmbedId: null,
  editingPath: null,

  startPicking: (embedId) => {
    const { selection } = get();
    const staysForThisEmbed = selection && selection.embedId === embedId;
    set({
      pickingEmbedId: embedId,
      hoveredPath: null,
      hoveredEmbedId: null,
      // A selection belonging to a different embed is stale once picking
      // starts on this one — clear it so a leftover selection from another
      // embed doesn't get sent to the agent alongside a fresh pick.
      selection: staysForThisEmbed ? selection : null,
      selectionHtmlSnapshot: staysForThisEmbed ? get().selectionHtmlSnapshot : null,
      // A (re-)start of picking always begins with no element mid-edit,
      // even if some earlier session left these set — there is no live
      // contenteditable element left to finish editing at this point.
      editingEmbedId: null,
      editingPath: null,
    });
  },

  stopPicking: () =>
    set({
      pickingEmbedId: null,
      hoveredPath: null,
      hoveredEmbedId: null,
      dropIndicator: null,
      editingEmbedId: null,
      editingPath: null,
    }),

  setHoveredPath: (path) => set({ hoveredPath: path }),

  setHoveredElement: (embedId, path) => set({ hoveredEmbedId: embedId, hoveredPath: path }),

  selectElement: (selection, htmlAtPick) =>
    set({ selection, selectionHtmlSnapshot: htmlAtPick ?? null }),

  clearSelection: () => set({ selection: null, selectionHtmlSnapshot: null }),

  noteSelectionEdit: (html, outerHtml, newPath) => {
    const { selection } = get();
    if (!selection) return;
    set({
      selectionHtmlSnapshot: html,
      selection: {
        ...selection,
        ...(outerHtml !== undefined ? { outerHtml: truncateOuterHtml(outerHtml) } : null),
        ...(newPath !== undefined ? { path: newPath } : null),
      },
    });
  },

  bumpDragVersion: () => set((s) => ({ dragVersion: s.dragVersion + 1 })),

  setCancelElementDrag: (cancel) => set({ cancelElementDrag: cancel }),

  setCancelElementEdit: (cancel) => set({ cancelElementEdit: cancel }),

  setRequestElementEdit: (request) => set({ requestElementEdit: request }),

  setDropIndicator: (indicator) => set({ dropIndicator: indicator }),

  setElementAffordanceVisible: (visible) => {
    if (get().elementAffordanceVisible === visible) return;
    set({ elementAffordanceVisible: visible });
  },
  startElementEdit: (embedId, path) => set({ editingEmbedId: embedId, editingPath: path }),

  stopElementEdit: () => set({ editingEmbedId: null, editingPath: null }),

  reset: () =>
    set({
      pickingEmbedId: null,
      hoveredPath: null,
      hoveredEmbedId: null,
      selection: null,
      selectionHtmlSnapshot: null,
      cancelElementDrag: null,
      cancelElementEdit: null,
      requestElementEdit: null,
      dropIndicator: null,
      elementAffordanceVisible: false,
      editingEmbedId: null,
      editingPath: null,
    }),
}));
