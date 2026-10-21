import type { EmbedNode } from "@/types/scene";
import { finalizeEmbedHtml, insertInstanceTag } from "@/lib/embedComponents";
import { findWinningMaster, selectComponentRegistry } from "@/store/componentRegistry";
import { applyEmbedHtmlUpdates } from "@/store/componentOps";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { resolveAbsoluteNodes } from "@/utils/absoluteNodes";
import { runToolCall } from "@/lib/toolCallQueue";

/**
 * Switch to `pageId` (when given and not the active page), then select `nodeId` and fit the
 * viewport to it. False when the node is not in the scene after the switch.
 */
function selectAndFit(nodeId: string, pageId?: string): boolean {
  const pages = usePageStore.getState();
  if (pageId && pageId !== pages.activePageId) pages.switchToPage(pageId);
  if (!useSceneStore.getState().nodesById[nodeId]) return false;
  useSelectionStore.getState().setSelectedIds([nodeId]);
  const { width, height } = getCanvasViewportMetrics();
  useViewportStore.getState().fitToContent(resolveAbsoluteNodes([nodeId]), width, height);
  return true;
}

/**
 * Switch to the page that holds the master of `key`, select it and fit the
 * viewport to it. Returns false when the key has no master.
 */
export function goToMaster(key: string): boolean {
  const found = findWinningMaster(key);
  return found ? selectAndFit(found.node.id, found.page.pageId) : false;
}

/**
 * Select `nodeId` wherever it lives: the active page (read from the live scene, whose page
 * snapshot may be stale) or any other page, switching to that page. False when no page has it.
 */
export function goToNode(nodeId: string): boolean {
  if (useSceneStore.getState().nodesById[nodeId]) return selectAndFit(nodeId);
  const { pages, activePageId } = usePageStore.getState();
  const page = pages.find((candidate) => candidate.id !== activePageId && candidate.nodesById[nodeId]);
  return page ? selectAndFit(nodeId, page.id) : false;
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
 * step, queued with other scene writes. The tag lands after the element picked in that embed, else at the end
 * of `<body>`.
 */
export function insertInstance(key: string, embedId: string): Promise<InsertResult> {
  // Same serialization point as every other scene-mutating call (chat, bridges, plugins).
  return runToolCall("edit_embed_html", async () => insertInstanceNow(key, embedId));
}

function insertInstanceNow(key: string, embedId: string): InsertResult {
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
