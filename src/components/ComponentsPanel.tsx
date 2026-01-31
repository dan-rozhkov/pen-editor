import clsx from "clsx";
import { DiamondsFourIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { getAllComponents } from "../utils/nodeUtils";
import { generateId } from "../types/scene";
import type { SceneNode, FrameNode, RefNode } from "../types/scene";
import { useNodePlacement } from "../hooks/useNodePlacement";

export function ComponentsPanel() {
  const nodes = useSceneStore((state) => state.nodes);
  const addNode = useSceneStore((state) => state.addNode);
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame);
  const { getSelectedFrame, getViewportCenter } = useNodePlacement();

  // Get all components from the scene
  const components = getAllComponents(nodes);

  const createInstance = (component: FrameNode) => {
    const { centerX, centerY } = getViewportCenter();

    const instance: RefNode = {
      id: generateId(),
      type: "ref",
      componentId: component.id,
      name: `${component.name || "Component"} instance`,
      x: centerX - component.width / 2,
      y: centerY - component.height / 2,
      width: component.width,
      height: component.height,
      visible: true,
    };

    const selectedFrame = getSelectedFrame();
    if (selectedFrame && selectedFrame.id !== component.id) {
      // Add as child to selected frame (position relative to frame)
      const childInstance = { ...instance, x: 10, y: 10 };
      addChildToFrame(selectedFrame.id, childInstance as SceneNode);
    } else {
      addNode(instance as SceneNode);
    }
  };

  if (components.length === 0) {
    return (
      <div className="bg-surface-panel flex flex-col select-none">
        <div className="relative border-b border-border-default">
          <div className="flex flex-col gap-2 pt-3">
            <div className="text-[11px] font-semibold text-text-primary px-4">
              Components
            </div>
            <div className="text-text-disabled text-xs text-center p-5">
              No components yet
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-panel flex flex-col select-none max-h-[200px]">
      <div className="relative border-b border-border-default">
        <div className="flex flex-col gap-2 pt-3">
          <div className="text-[11px] font-semibold text-text-primary px-4">
            Components
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {components.map((component) => (
              <button
                key={component.id}
                onClick={() => createInstance(component)}
                className={clsx(
                  "w-full flex items-center gap-2 px-4 py-2 text-left",
                  "hover:bg-surface-elevated transition-colors duration-100",
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
      </div>
    </div>
  );
}
