import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { selectAllInScope } from "@/components/canvas/keyboardShortcutUtils";
import { copyAsCss, copyAsSvg } from "@/components/canvas/copyAsActions";
import { formatShortcut } from "./shortcutFormat";
import type { PaletteCommand } from "./types";

/**
 * Clipboard/style-clipboard actions live as closures inside
 * `useCanvasKeyboardShortcuts` (they need `dimensions`, `addNode`, etc. from
 * the canvas hook's lifecycle) and are only reachable from outside via the
 * `pen-editor:*` custom events the Toolbar's File > Edit menu already
 * dispatches. Reuse that same event bus here instead of re-implementing
 * clipboard logic.
 */
function dispatch(eventName: string): void {
  window.dispatchEvent(new Event(eventName));
}

function undo(): void {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
}

function redo(): void {
  const snapshot = createSnapshot(useSceneStore.getState());
  const next = useHistoryStore.getState().redo(snapshot);
  if (next) useSceneStore.getState().restoreSnapshot(next);
}

function selectAll(): void {
  const nodes = useSceneStore.getState().getNodes();
  const ids = selectAllInScope(nodes, useSelectionStore.getState());
  if (ids) useSelectionStore.getState().setSelectedIds(ids);
}

function groupSelection(): void {
  const ids = useSelectionStore.getState().selectedIds;
  if (ids.length < 2) return;
  const groupId = useSceneStore.getState().groupNodes(ids);
  if (groupId) useSelectionStore.getState().select(groupId);
}

function ungroupSelection(): void {
  const ids = useSelectionStore.getState().selectedIds;
  if (ids.length < 1) return;
  const childIds = useSceneStore.getState().ungroupNodes(ids);
  if (childIds.length > 0) useSelectionStore.getState().setSelectedIds(childIds);
}

function deleteSelection(): void {
  const ids = useSelectionStore.getState().selectedIds;
  if (ids.length === 0) return;
  const historyStore = useHistoryStore.getState();
  historyStore.saveHistory(createSnapshot(useSceneStore.getState()));
  withHistoryBatch(() => {
    ids.forEach((id) => useSceneStore.getState().deleteNode(id));
  });
  useSelectionStore.getState().clearSelection();
}

export function getEditCommands(): PaletteCommand[] {
  return [
    { id: "edit-undo", label: "Undo", group: "Edit", shortcut: formatShortcut(["mod", "Z"]), run: undo },
    { id: "edit-redo", label: "Redo", group: "Edit", shortcut: formatShortcut(["mod", "shift", "Z"]), run: redo },
    { id: "edit-cut", label: "Cut", group: "Edit", shortcut: formatShortcut(["mod", "X"]), run: () => dispatch("pen-editor:cut") },
    { id: "edit-copy", label: "Copy", group: "Edit", shortcut: formatShortcut(["mod", "C"]), run: () => dispatch("pen-editor:copy") },
    { id: "edit-paste", label: "Paste", group: "Edit", shortcut: formatShortcut(["mod", "V"]), run: () => dispatch("pen-editor:paste") },
    {
      id: "edit-copy-properties",
      label: "Copy properties",
      group: "Edit",
      shortcut: formatShortcut(["mod", "alt", "C"]),
      keywords: ["copy style"],
      run: () => dispatch("pen-editor:copy-style"),
    },
    {
      id: "edit-paste-properties",
      label: "Paste properties",
      group: "Edit",
      shortcut: formatShortcut(["mod", "alt", "V"]),
      keywords: ["paste style"],
      run: () => dispatch("pen-editor:paste-style"),
    },
    {
      id: "edit-copy-as-css",
      label: "Copy as CSS",
      group: "Edit",
      shortcut: formatShortcut(["mod", "shift", "C"]),
      run: () => void copyAsCss(),
    },
    {
      id: "edit-copy-as-svg",
      label: "Copy as SVG",
      group: "Edit",
      shortcut: formatShortcut(["mod", "shift", "S"]),
      run: () => void copyAsSvg(),
    },
    { id: "edit-select-all", label: "Select all", group: "Edit", shortcut: formatShortcut(["mod", "A"]), run: selectAll },
    { id: "edit-group", label: "Group selection", group: "Edit", shortcut: formatShortcut(["mod", "G"]), keywords: ["group"], run: groupSelection },
    { id: "edit-ungroup", label: "Ungroup selection", group: "Edit", shortcut: formatShortcut(["mod", "shift", "G"]), keywords: ["ungroup"], run: ungroupSelection },
    { id: "edit-delete", label: "Delete selection", group: "Edit", shortcut: "⌫", keywords: ["delete", "remove"], run: deleteSelection },
  ];
}
