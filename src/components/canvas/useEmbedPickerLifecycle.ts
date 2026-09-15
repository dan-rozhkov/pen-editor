import { useEffect } from "react";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";
import { findHiddenSelfOrAncestor } from "@/utils/nodeUtils";
import type { EmbedNode } from "@/types/scene";

/**
 * Keeps the embed element picker store honest as selection/scene state
 * changes elsewhere — mounted once at the PixiCanvas level.
 *
 * - **Auto-start**: as soon as an embed becomes the SOLE selected node, this
 *   turns picking on for it — there is no more manual toggle (the
 *   "Select element" button in `EmbedActionBar` was removed; inline edit
 *   moved to the properties panel's "Edit inline" button). Guarded the same
 *   way the auto-exit checks below are: not while the inline HTML editor is
 *   open on it (`editingMode === "embed"`), not while an "interactive" embed
 *   is active (`activeEmbedId` — no UI sets this today, kept for parity),
 *   and only in an editable mode (`canEditScene`) so view/present/shared-view
 *   never enters picking. No infinite loop: this branch only runs in the
 *   `else` of "picking is already active" below, so a `check()` re-run while
 *   already picking this same embed takes the other branch and does nothing;
 *   `check()` also never subscribes to `embedPickerStore`, so calling
 *   `startPicking` here can't itself cause a re-entrant `check()` call in
 *   the first place.
 * - **Why `editorModeStore` is also subscribed**: the auto-start gate reads
 *   `canEditScene(mode)` fresh on every `check()`, but a mode change alone
 *   does not touch `selectionStore` or `sceneStore` — so without this
 *   subscription an already-selected embed would stay un-picked after
 *   `exitToEdit()` (Escape from view mode, `keyboardCommands.ts`;
 *   `SharedCanvasPage.tsx`'s fork flow) until something else happened to
 *   also change the selection. `enterView`/`enterPresent` mask this in
 *   practice because they clear the selection as a side effect (which does
 *   fire `selectionStore`'s subscription), but `exitToEdit()` does not —
 *   there is nothing to "undo" about the selection, it just re-enables
 *   editing on whatever was already selected.
 * - Deselecting the picking embed, selecting something else, or opening the
 *   inline HTML editor on it (`editingMode === "embed"` + `editingNodeId`,
 *   from the "Edit inline" button in the properties panel's
 *   `EmbedContentSection`) all exit picking mode. Escape no longer exits
 *   picking directly (see `selectionStore.exitContainer`'s step -1) — it
 *   clears a picked *element* first, and otherwise deselects the embed node
 *   itself, which this hook then reacts to. This covers every OTHER way the
 *   same states can change (clicking elsewhere on the canvas, opening a
 *   different node from the layers panel, etc). The `activeEmbedId` check
 *   below is kept alongside the inline-edit one — nothing in the UI sets
 *   `activeEmbedId` today (no "Interact" affordance exists), so it is
 *   currently a no-op, but it is cheap and correct if that affordance comes
 *   back.
 * - A stored `selection` is cleared as soon as its embed is no longer the
 *   SOLE selected node — the highlight (and the element context sent to the
 *   agent) is meant to stay visible exactly while the picked element's
 *   embed stays selected. Exiting *picking mode* alone (entering inline
 *   edit, or Escape clearing just the picked element via `exitContainer`)
 *   does NOT clear it — the embed is still selected then, which is the
 *   whole point of the feature: the context survives so the agent can act
 *   on it. Deleting the embed node trivially fails this same check (it can
 *   no longer be selected at all), so no separate deletion branch is
 *   needed.
 * - Picking mode AND a stored `selection` are both dropped as soon as the
 *   embed stops being rendered as a live DOM host by `EmbedLayer` — outline
 *   render mode drops every host, and a hidden/disabled embed (or any
 *   ancestor) takes the whole subtree off screen. The picker is defined
 *   entirely against that host's shadow DOM: with no host there is nothing
 *   to hover, nothing to outline, and the retained pick would keep
 *   describing to the agent an element the user can no longer see. It also
 *   keeps the on-canvas agent affordances honest — `PixiCanvas` suppresses
 *   the embed-level button whenever a pick names that embed, on the
 *   assumption that `EmbedElementHighlight` draws the element-scoped one
 *   instead, which it can't do without a host.
 * - A stored `selection` is also cleared if the owning embed's
 *   `htmlContent` has changed since the pick (e.g. the agent just ran
 *   `edit_embed_html`) — the recorded `outerHtml` and positional
 *   `nth-of-type` `path` may no longer describe the same element, so
 *   keeping it around would point the highlight at one thing while telling
 *   the agent another.
 */
export function useEmbedPickerLifecycle(): void {
  useEffect(() => {
    const check = () => {
      const { pickingEmbedId, selection, selectionHtmlSnapshot } =
        useEmbedPickerStore.getState();
      const { selectedIds, activeEmbedId, editingNodeId, editingMode } =
        useSelectionStore.getState();

      // Mirrors EmbedLayer's own `embedIds` filter (outline mode / hidden
      // self-or-ancestor) — the two ways an embed keeps existing in the
      // scene while having no DOM host to pick inside of.
      const hasDomHost = (embedId: string): boolean => {
        if (useRenderModeStore.getState().renderMode === "outline") return false;
        const { nodesById, parentById } = useSceneStore.getState();
        return !findHiddenSelfOrAncestor(nodesById, parentById, embedId);
      };

      if (pickingEmbedId) {
        const stillSelectedAlone =
          selectedIds.length === 1 && selectedIds[0] === pickingEmbedId;
        const enteredInteractMode = activeEmbedId === pickingEmbedId;
        const enteredInlineEdit =
          editingMode === "embed" && editingNodeId === pickingEmbedId;
        if (
          !stillSelectedAlone ||
          enteredInteractMode ||
          enteredInlineEdit ||
          !hasDomHost(pickingEmbedId)
        ) {
          useEmbedPickerStore.getState().stopPicking();
        }
      } else if (
        selectedIds.length === 1 &&
        editingMode !== "embed" &&
        !activeEmbedId &&
        canEditScene(useEditorModeStore.getState().mode)
      ) {
        // Auto-start: see the doc comment above. Only reached when nothing
        // is currently being picked (the `if` above handles the picking-
        // already-active case, including turning it off), so there's no
        // "double start" to worry about here.
        const soleId = selectedIds[0];
        const soleNode = useSceneStore.getState().nodesById[soleId];
        // `hasDomHost` is checked here too, not just in the stop branch
        // above: starting picking on an embed `EmbedLayer` isn't rendering
        // (outline mode, hidden self-or-ancestor) would be immediately
        // undone by the very next `check()`, flapping the store for a mode
        // in which there is no shadow DOM to pick inside of at all.
        if (soleNode?.type === "embed" && hasDomHost(soleId)) {
          useEmbedPickerStore.getState().startPicking(soleId);
        }
      }

      if (selection) {
        const embedStillSoleSelection =
          selectedIds.length === 1 && selectedIds[0] === selection.embedId;
        const embedNode = useSceneStore.getState().nodesById[selection.embedId] as
          | EmbedNode
          | undefined;
        const htmlChangedSincePick =
          selectionHtmlSnapshot !== null &&
          !!embedNode &&
          embedNode.htmlContent !== selectionHtmlSnapshot;

        if (
          !embedStillSoleSelection ||
          !embedNode ||
          htmlChangedSincePick ||
          !hasDomHost(selection.embedId)
        ) {
          useEmbedPickerStore.getState().clearSelection();
        }
      }
    };

    check();
    const unsubSelection = useSelectionStore.subscribe(check);
    const unsubScene = useSceneStore.subscribe(check);
    // Render mode is neither selection nor scene state, so flipping to
    // outline mode would otherwise go unnoticed until some unrelated store
    // write happened to re-run the check.
    const unsubRenderMode = useRenderModeStore.subscribe(check);
    // Same gap for the editor mode, which gates auto-starting the picker:
    // `exitToEdit()` (Escape out of view mode, and SharedCanvasPage's fork
    // flow) changes the mode without touching the selection, so nothing
    // else would re-run the check.
    const unsubEditorMode = useEditorModeStore.subscribe(check);
    return () => {
      unsubSelection();
      unsubScene();
      unsubRenderMode();
      unsubEditorMode();
    };
  }, []);
}
