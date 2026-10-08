import type { EmbedNode, SceneNode } from "@/types/scene";
import { finalizeEmbedHtml, insertInstanceTag } from "@/lib/embedComponents";
import { findWinningMaster, selectComponentRegistry } from "@/store/componentRegistry";
import { applyEmbedHtmlUpdates } from "@/store/componentOps";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";

/**
 * Switch to the page that holds the master of `key`, select it and fit the
 * viewport to it. Returns false when the key has no master.
 */
export function goToMaster(key: string): boolean {
  const found = findWinningMaster(key);
  if (!found) return false;
  const pages = usePageStore.getState();
  if (found.page.pageId !== pages.activePageId) pages.switchToPage(found.page.pageId);
  const node = useSceneStore.getState().nodesById[found.node.id];
  if (!node) return false;
  useSelectionStore.getState().setSelectedIds([node.id]);
  const { width, height } = getCanvasViewportMetrics();
  useViewportStore.getState().fitToContent([node as unknown as SceneNode], width, height);
  return true;
}

/** The single selected embed screen (not a component master) that can take an instance, or null. */
export function insertTargetEmbed(selectedIds: readonly string[]): EmbedNode | null {
  if (selectedIds.length !== 1) return null;
  const node = useSceneStore.getState().nodesById[selectedIds[0]] as unknown as EmbedNode | undefined;
  return node?.type === "embed" && !node.component ? node : null;
}

export type InsertResult = { ok: true; embedName: string } | { ok: false; error: string };

/**
 * Write `<c-KEY>` into an embed through the same path the agent's edits take
 * (`finalizeEmbedHtml`: tag expansion, write guard, reconcile), as one undo
 * step. The tag lands after the element picked in that embed, else at the end
 * of `<body>`.
 */
export function insertInstance(key: string, embedId: string): InsertResult {
  const node = useSceneStore.getState().nodesById[embedId] as unknown as EmbedNode | undefined;
  if (node?.type !== "embed" || node.component) {
    return { ok: false, error: "Select a screen to insert into." };
  }
  const registry = selectComponentRegistry();
  if (!registry.has(key)) return { ok: false, error: `Component "${key}" is not defined.` };
  const previous = node.htmlContent ?? "";
  const picked = useEmbedPickerStore.getState().selection;
  const withTag = insertInstanceTag(previous, key, picked?.embedId === embedId ? picked.path : null);
  if (withTag === null) return { ok: false, error: "Could not read the screen HTML." };
  const finalized = finalizeEmbedHtml(withTag, { registry, previousHtml: previous });
  if (!finalized.ok) return { ok: false, error: finalized.error };
  applyEmbedHtmlUpdates([{ nodeId: embedId, html: finalized.html }]);
  return { ok: true, embedName: node.name ?? "screen" };
}
