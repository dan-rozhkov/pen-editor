import { useEffect } from "react";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import type { EmbedNode } from "@/types/scene";

/**
 * Keeps the embed element picker store honest as selection/scene state
 * changes elsewhere — mounted once at the PixiCanvas level.
 *
 * - Deselecting the picking embed, selecting something else, or opening the
 *   inline HTML editor on it (`editingMode === "embed"` + `editingNodeId`,
 *   from the "Inline edit" button in `EmbedActionBar`) all exit picking
 *   mode. Escape already exits picking with priority via
 *   `selectionStore.exitContainer`; this covers every OTHER way the same
 *   states can change (clicking elsewhere on the canvas, opening a
 *   different node from the layers panel, etc). The `activeEmbedId` check
 *   below is kept alongside the inline-edit one — nothing in the UI sets
 *   `activeEmbedId` today (no "Interact" affordance exists), so it is
 *   currently a no-op, but it is cheap and correct if that affordance comes
 *   back.
 * - A stored `selection` is cleared as soon as its embed is no longer the
 *   SOLE selected node — the highlight (and the element context sent to the
 *   agent) is meant to stay visible exactly while the picked element's
 *   embed stays selected. Exiting *picking mode* alone (toolbar toggle,
 *   Escape) does NOT clear it — the embed is still selected then, which is
 *   the whole point of the feature: the context survives so the agent can
 *   act on it. Deleting the embed node trivially fails this same check (it
 *   can no longer be selected at all), so no separate deletion branch is
 *   needed.
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

      if (pickingEmbedId) {
        const stillSelectedAlone =
          selectedIds.length === 1 && selectedIds[0] === pickingEmbedId;
        const enteredInteractMode = activeEmbedId === pickingEmbedId;
        const enteredInlineEdit =
          editingMode === "embed" && editingNodeId === pickingEmbedId;
        if (!stillSelectedAlone || enteredInteractMode || enteredInlineEdit) {
          useEmbedPickerStore.getState().stopPicking();
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

        if (!embedStillSoleSelection || !embedNode || htmlChangedSincePick) {
          useEmbedPickerStore.getState().clearSelection();
        }
      }
    };

    check();
    const unsubSelection = useSelectionStore.subscribe(check);
    const unsubScene = useSceneStore.subscribe(check);
    return () => {
      unsubSelection();
      unsubScene();
    };
  }, []);
}
