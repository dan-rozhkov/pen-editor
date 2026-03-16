import clsx from "clsx";
import { DiamondsFour } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { getAllComponentsFlat } from "../utils/componentUtils";
import { generateId } from "../types/scene";
import type { SceneNode, FlatFrameNode, RefNode } from "../types/scene";
import { useNodePlacement } from "../hooks/useNodePlacement";
import { useComponentThumbnails } from "../hooks/useComponentThumbnails";

export function ComponentsPanel() {
  const nodesById = useSceneStore((state) => state.nodesById);
  const addNode = useSceneStore((state) => state.addNode);
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame);
  const { getSelectedFrame, getViewportCenter } = useNodePlacement();

  const components = getAllComponentsFlat(nodesById);
  const thumbnails = useComponentThumbnails(components);

  const createInstance = (component: FlatFrameNode) => {
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
      const childInstance = { ...instance, x: 10, y: 10 };
      addChildToFrame(selectedFrame.id, childInstance as SceneNode);
    } else {
      addNode(instance as SceneNode);
    }

    useSelectionStore.getState().select(instance.id);
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
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-2">
          {components.map((component) => {
            const thumb = thumbnails.get(component.id);
            return (
              <button
                key={component.id}
                onClick={() => createInstance(component)}
                className={clsx(
                  "flex flex-col items-center gap-1 p-2 rounded-lg",
                  "hover:bg-surface-elevated",
                )}
              >
                <div className="aspect-square w-full bg-surface-elevated rounded-md flex items-center justify-center overflow-hidden">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={component.name || "Component"}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <DiamondsFour
                      size={24}
                      weight="thin"
                      className="text-text-secondary"
                    />
                  )}
                </div>
                <span className="text-[11px] text-text-secondary truncate w-full text-center">
                  {component.name || "Component"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
