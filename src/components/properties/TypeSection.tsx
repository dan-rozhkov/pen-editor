import { DiamondsFour } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import type { SceneNode } from "@/types/scene";
import { findComponentById } from "@/utils/nodeUtils";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";

interface TypeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  allNodes?: SceneNode[];
}

export function TypeSection({ node, onUpdate, allNodes }: TypeSectionProps) {
  const comp =
    node.type === "ref" && allNodes
      ? findComponentById(allNodes, node.componentId)
      : null;

  const typeLabel =
    node.type === "ref"
      ? comp?.name || "Component"
      : node.type;

  return (
    <PropertySection title="Type">
      <div className="flex items-center gap-2">
        {node.type === "group" ||
        (node.type === "frame" && !node.reusable) ? (
          <>
            <div className="flex-1">
              <SelectInput
                value={node.type}
                options={[
                  { value: "frame", label: "Frame" },
                  { value: "group", label: "Group" },
                ]}
                onChange={(v) => {
                  if (v !== node.type) {
                    useSceneStore.getState().convertNodeType(node.id);
                  }
                }}
              />
            </div>
            {node.type === "frame" && !node.reusable && (
              <button
                className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors"
                onClick={() =>
                  onUpdate({ reusable: true } as Partial<SceneNode>)
                }
                title="Create Component"
              >
                <DiamondsFour size={16} />
              </button>
            )}
          </>
        ) : (
          <div className="text-xs text-text-secondary capitalize">
            {typeLabel}
          </div>
        )}
      </div>
    </PropertySection>
  );
}
