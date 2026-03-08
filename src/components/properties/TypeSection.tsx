import { Diamond, DiamondsFour, Minus } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { SceneNode } from "@/types/scene";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";

interface TypeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function TypeSection({ node, onUpdate }: TypeSectionProps) {
  const typeLabel = node.type;

  return (
    <PropertySection title="Type">
      <div className="flex items-center gap-2">
        {node.type === "group" ||
        (node.type === "frame") ? (
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
            {node.type === "frame" && (
              <button
                className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors"
                onClick={() => {
                  const embedId = useSceneStore.getState().convertDesignToEmbed(node.id, { isComponent: true });
                  if (embedId) {
                    useSelectionStore.getState().select(embedId);
                  }
                }}
                title="Create Component"
              >
                <DiamondsFour size={16} />
              </button>
            )}
          </>
        ) : node.type === "embed" ? (
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-text-secondary capitalize">
              {typeLabel}
            </div>
            {node.isComponent ? (
              <button
                className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors relative"
                onClick={() => {
                  onUpdate({ isComponent: undefined } as Partial<SceneNode>);
                }}
                title="Detach Component"
              >
                <Diamond size={16} />
                <Minus size={8} weight="bold" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </button>
            ) : (
              <button
                className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors"
                onClick={() => {
                  onUpdate({ isComponent: true } as Partial<SceneNode>);
                }}
                title="Create Component"
              >
                <DiamondsFour size={16} />
              </button>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-secondary capitalize">
            {typeLabel}
          </div>
        )}
      </div>
    </PropertySection>
  );
}
