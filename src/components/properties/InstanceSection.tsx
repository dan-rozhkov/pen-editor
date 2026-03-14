import type { RefNode, SceneNode } from "@/types/scene";
import { findComponentById } from "@/utils/nodeUtils";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

interface InstanceSectionProps {
  node: RefNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  allNodes: SceneNode[];
  isOverridden: <T>(instanceVal: T | undefined, componentVal: T | undefined) => boolean;
}

export function InstanceSection({
  node,
  onUpdate,
  allNodes,
  isOverridden,
}: InstanceSectionProps) {
  const detachInstance = useSceneStore((s) => s.detachInstance);
  const setSelectedIds = useSelectionStore((s) => s.setSelectedIds);
  const component = findComponentById(allNodes, node.componentId);

  const overrides: string[] = [];
  if (isOverridden(node.fill, component?.fill)) overrides.push("Fill");
  if (isOverridden(node.stroke, component?.stroke)) overrides.push("Stroke");
  if (isOverridden(node.strokeWidth, component?.strokeWidth)) overrides.push("Stroke Width");

  const slotIds = component?.slot ?? [];
  const replacedSlots = slotIds.filter((id) => node.overrides?.[id]?.kind === "replace");

  return (
    <PropertySection title="Instance">
      <div className="flex items-center gap-2 text-xs text-purple-400">
        <span>Instance of: {component?.name || "Component"}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <button
          onClick={() => {
            const detachedId = detachInstance(node.id);
            if (detachedId) {
              setSelectedIds([detachedId]);
            }
          }}
          className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
        >
          Detach Instance
        </button>
      </div>
      {slotIds.length > 0 && (
        <div className="mt-2 text-xs text-text-secondary">
          Slots: {replacedSlots.length}/{slotIds.length} replaced
        </div>
      )}
      {overrides.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-xs text-text-secondary">{overrides.join(", ")}</div>
          <button
            onClick={() => {
              onUpdate({
                fill: undefined,
                stroke: undefined,
                strokeWidth: undefined,
                fillBinding: undefined,
                strokeBinding: undefined,
              });
            }}
            className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
          >
            Reset All Overrides
          </button>
        </div>
      )}
    </PropertySection>
  );
}
