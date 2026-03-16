import { Diamond, DiamondsFour, Minus } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { SceneNode } from "@/types/scene";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";

interface TypeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  typeLabelOverride?: string;
}

export function TypeSection({ node, onUpdate, typeLabelOverride }: TypeSectionProps) {
  const detachInstance = useSceneStore((s) => s.detachInstance);
  const setSelectedIds = useSelectionStore((s) => s.setSelectedIds);
  const typeLabel = typeLabelOverride ?? (node.type === "ref" ? "Instance" : node.type);
  const isContainerType = node.type === "frame" || node.type === "group";
  const isFrame = node.type === "frame";
  const isInstance = node.type === "ref";

  return (
    <PropertySection title="Type">
      <div className="flex items-center gap-2">
        {isContainerType ? (
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
            {isFrame && (
              <button
                type="button"
                onClick={() => {
                  onUpdate({
                    reusable: !node.reusable,
                  } as Partial<SceneNode>);
                }}
                title={node.reusable ? "Detach Component" : "Create Component"}
                aria-label={node.reusable ? "Detach Component" : "Create Component"}
                className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors relative"
              >
                {node.reusable ? (
                  <>
                    <Diamond size={16} />
                    <Minus size={8} weight="bold" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </>
                ) : (
                  <DiamondsFour size={16} />
                )}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="text-xs text-text-secondary capitalize flex-1">
              {typeLabel}
            </div>
            {isInstance && (
              <button
                type="button"
                onClick={() => {
                  const detachedId = detachInstance(node.id);
                  if (detachedId) {
                    setSelectedIds([detachedId]);
                  }
                }}
                title="Detach Instance"
                aria-label="Detach Instance"
                className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors relative"
              >
                <Diamond size={16} />
                <Minus size={8} weight="bold" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </button>
            )}
          </>
        )}
      </div>
    </PropertySection>
  );
}
