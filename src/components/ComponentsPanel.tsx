import clsx from "clsx";
import { DiamondsFourIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { getAllComponentsFlat } from "../utils/componentUtils";
import { generateId } from "../types/scene";
import type { SceneNode, EmbedNode } from "../types/scene";
import { useNodePlacement } from "../hooks/useNodePlacement";

export function ComponentsPanel() {
  const nodesById = useSceneStore((state) => state.nodesById);
  const addNode = useSceneStore((state) => state.addNode);
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame);
  const { getSelectedFrame, getViewportCenter } = useNodePlacement();

  // Get all component embeds from the scene
  const components = getAllComponentsFlat(nodesById);

  const createInstance = (component: EmbedNode) => {
    const { centerX, centerY } = getViewportCenter();

    const copy: EmbedNode = {
      id: generateId(),
      type: "embed",
      name: `${component.name || "Component"}`,
      x: centerX - component.width / 2,
      y: centerY - component.height / 2,
      width: component.width,
      height: component.height,
      htmlContent: component.htmlContent,
      visible: true,
    };

    const selectedFrame = getSelectedFrame();
    if (selectedFrame && selectedFrame.id !== component.id) {
      // Add as child to selected frame (position relative to frame)
      const childCopy = { ...copy, x: 10, y: 10 };
      addChildToFrame(selectedFrame.id, childCopy as SceneNode);
    } else {
      addNode(copy as SceneNode);
    }
  };

  if (components.length === 0) {
    return (
      <div className="h-full bg-surface-panel flex flex-col select-none">
        <div className="text-text-disabled text-xs text-center p-5">
          No components yet
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-surface-panel flex flex-col select-none overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1">
        {components.map((component) => (
          <button
            key={component.id}
            onClick={() => createInstance(component)}
            className={clsx(
              "w-full flex items-center gap-2 px-4 py-2 text-left",
              "hover:bg-surface-elevated",
            )}
          >
            <DiamondsFourIcon
              size={16}
              className="shrink-0 text-purple-400"
            />
            <span className="text-xs text-text-secondary truncate">
              {component.name || "Component"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
