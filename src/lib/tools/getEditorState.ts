import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { usePageStore } from "@/store/pageStore";
import { collectDocumentComponents } from "@/lib/documentComponents";
import type { ToolHandler } from "../toolRegistry";

export const getEditorState: ToolHandler = async () => {
  const { rootIds, nodesById, childrenById, componentArtifactsById } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();
  const { scale, x, y } = useViewportStore.getState();

  const roots = rootIds.map((id) => {
    const n = nodesById[id];
    if (!n) return { id };
    return { id: n.id, type: n.type, name: n.name };
  });

  // Single pass: collect document components, then derive both response shapes
  const docComponents = collectDocumentComponents(nodesById, componentArtifactsById, childrenById);

  const reusableComponents = docComponents.map((c) => ({
    id: c.id,
    type: "frame" as const,
    name: c.name,
    htmlContent: c.templateHtml,
    syncState: componentArtifactsById[c.id]?.syncState ?? "missing",
  }));

  const documentComponents = docComponents.map((c) => ({
    id: c.id,
    name: c.name,
    tag: c.tag,
    width: c.width,
    height: c.height,
    slots: c.slots,
  }));

  const selectedNodes = selectedIds.map((id) => {
    const n = nodesById[id];
    if (!n) return { id };
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    };
  });

  const { pages, activePageId } = usePageStore.getState();
  const pagesInfo = pages.map((p) => ({ id: p.id, name: p.name }));

  return JSON.stringify({
    pages: pagesInfo,
    activePageId,
    roots,
    selectedIds,
    selectedNodes,
    reusableComponents,
    documentComponents,
    viewport: { scale, x, y },
  });
};
