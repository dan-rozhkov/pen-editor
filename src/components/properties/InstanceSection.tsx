import type { SceneNode, RefNode } from "@/types/scene";
import { findComponentById } from "@/utils/nodeUtils";
import { PropertySection } from "@/components/ui/PropertyInputs";

interface InstanceSectionProps {
  node: SceneNode;
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
  const comp = findComponentById(allNodes, (node as { componentId: string }).componentId);

  const overrides: string[] = [];
  if (isOverridden(node.fill, comp?.fill)) overrides.push("Fill");
  if (isOverridden(node.stroke, comp?.stroke)) overrides.push("Stroke");
  if (isOverridden(node.strokeWidth, comp?.strokeWidth))
    overrides.push("Stroke Width");
  if (isOverridden(node.fillBinding, comp?.fillBinding))
    overrides.push("Fill Variable");
  if (isOverridden(node.strokeBinding, comp?.strokeBinding))
    overrides.push("Stroke Variable");

  // Slot status — components (ref nodes) inside components are automatically slots
  const refNode = node as RefNode;
  const slotChildren = comp?.children?.filter((c) => c.type === 'ref') ?? [];
  const slotIds = slotChildren.map((c) => c.id);
  const replacedSlots = slotIds.filter((id) => refNode.slotContent?.[id]);

  return (
    <PropertySection title="Instance">
      <div className="flex items-center gap-2 text-xs text-purple-400">
        <svg viewBox="0 0 16 16" className="w-4 h-4">
          <path
            d="M8 2 L14 8 L8 14 L2 8 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span>Instance of: {comp?.name || "Component"}</span>
      </div>
      {slotIds.length > 0 && (
        <div className="mt-2 text-xs text-text-secondary">
          Slots: {replacedSlots.length}/{slotIds.length} replaced
        </div>
      )}
      {overrides.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
            Overrides ({overrides.length})
          </div>
          <div className="text-xs text-text-secondary">
            {overrides.join(", ")}
          </div>
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
