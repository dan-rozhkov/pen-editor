import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
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

  const reusableComponents = Object.values(nodesById)
    .filter((n) => n.type === "frame" && (n as { reusable?: boolean }).reusable)
    .map((n) => ({ id: n.id, type: n.type, name: n.name }));

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

  return JSON.stringify({
    roots,
    selectedIds,
    selectedNodes,
    reusableComponents,
    viewport: { scale, x, y },
  });
};
