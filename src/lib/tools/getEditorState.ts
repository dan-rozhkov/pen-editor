import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { usePageStore } from "@/store/pageStore";
import { useDocumentStore } from "@/store/documentStore";
import type { ToolHandler } from "../toolRegistry";

export const getEditorState: ToolHandler = async () => {
  const { rootIds, nodesById } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();
  const { scale, x, y } = useViewportStore.getState();

  const roots = rootIds.map((id) => {
    const n = nodesById[id];
    if (!n) return { id };
    return { id: n.id, type: n.type, name: n.name };
  });

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

  // Document identity: `fileName` is the only stable identifier the store
  // currently tracks (`useDocumentStore`). There is no document/session id
  // anywhere in the app state, so we do not fabricate one here — see
  // desktop-mcp-bridge.md finding 0.4. `fileName` is `null` before the
  // document has been saved/named for the first time; keep it `null` (not
  // omitted/undefined) so JSON.stringify always emits the key.
  const { fileName } = useDocumentStore.getState();

  return JSON.stringify({
    fileName,
    pages: pagesInfo,
    activePageId,
    roots,
    selectedIds,
    selectedNodes,
    viewport: { scale, x, y },
  });
};
