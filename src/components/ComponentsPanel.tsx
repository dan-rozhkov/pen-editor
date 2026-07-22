import { useMemo, useState } from "react";
import clsx from "clsx";
import { DiamondsFour, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { getAllComponentsFlat } from "../utils/componentUtils";
import { generateId } from "../types/scene";
import type { SceneNode, FlatFrameNode, RefNode } from "../types/scene";
import { useNodePlacement } from "../hooks/useNodePlacement";
import { useComponentThumbnails } from "../hooks/useComponentThumbnails";
import { PanelEmptyState } from "./PanelEmptyState";
import { Input } from "./ui/input";

export function ComponentsPanel() {
  const nodesById = useSceneStore((state) => state.nodesById);
  const addNode = useSceneStore((state) => state.addNode);
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame);
  const { getSelectedFrame, getViewportCenter } = useNodePlacement();
  const [searchQuery, setSearchQuery] = useState("");

  // Thumbnail generation updates local state. Keep this derived list stable
  // across that render so it cannot recursively trigger another extraction.
  const components = useMemo(
    () => getAllComponentsFlat(nodesById),
    [nodesById],
  );
  const thumbnails = useComponentThumbnails(components);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredComponents = normalizedQuery
    ? components.filter((component) => (component.name ?? "").toLocaleLowerCase().includes(normalizedQuery))
    : components;

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

  return (
    <div className="h-full bg-surface-panel flex flex-col select-none overflow-hidden">
      <div className="relative px-3 pt-3 pb-2">
        <MagnifyingGlassIcon
          aria-hidden
          size={14}
          className="pointer-events-none absolute top-[26px] left-5 -translate-y-1/2 text-text-muted"
        />
        <Input
          aria-label="Search components"
          placeholder="Search components…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-7 pl-7"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-5">
        {components.length === 0 ? (
          <PanelEmptyState icon={<DiamondsFour size={28} weight="light" />}>
            No components yet
          </PanelEmptyState>
        ) : filteredComponents.length === 0 ? (
          <PanelEmptyState icon={null}>No components found.</PanelEmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredComponents.map((component) => {
            const thumb = thumbnails.get(component.id);
            return (
              <button
                key={component.id}
                onClick={() => createInstance(component)}
                className={clsx(
                  "flex flex-col items-center gap-1 p-2 rounded-lg",
                  "hover:bg-secondary",
                )}
              >
                <div className="aspect-square w-full bg-secondary rounded-md flex items-center justify-center overflow-hidden">
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
        )}
      </div>
    </div>
  );
}
