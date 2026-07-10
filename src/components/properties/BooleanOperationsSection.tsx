import {
  ExcludeSquareIcon,
  IntersectSquareIcon,
  StackIcon,
  SubtractSquareIcon,
  UniteSquareIcon,
} from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { BOOLEAN_SUPPORTED_TYPES, type BooleanOpKind } from "@/lib/booleanOps";
import type { SceneNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface BooleanOperationsSectionProps {
  selectedIds: string[];
  selectedNodes: SceneNode[];
}

const OPS: { op: BooleanOpKind; label: string; Icon: typeof UniteSquareIcon }[] = [
  { op: "union", label: "Union", Icon: UniteSquareIcon },
  { op: "subtract", label: "Subtract", Icon: SubtractSquareIcon },
  { op: "intersect", label: "Intersect", Icon: IntersectSquareIcon },
  { op: "exclude", label: "Exclude", Icon: ExcludeSquareIcon },
  { op: "flatten", label: "Flatten", Icon: StackIcon },
];

/**
 * Union / Subtract / Intersect / Exclude / Flatten for 2+ selected shapes.
 * Only shown when every selected node is a boolean-eligible shape type
 * (rect/ellipse/polygon/path) — `booleanOperation` itself also validates that
 * they share a parent and no-ops (returns null) otherwise.
 */
export function BooleanOperationsSection({ selectedIds, selectedNodes }: BooleanOperationsSectionProps) {
  if (selectedNodes.length < 2) return null;
  if (!selectedNodes.every((node) => BOOLEAN_SUPPORTED_TYPES.has(node.type))) return null;

  const handleOp = (op: BooleanOpKind) => {
    const resultId = useSceneStore.getState().booleanOperation(selectedIds, op);
    if (resultId) useSelectionStore.getState().select(resultId);
  };

  const iconSize = 16;
  const buttonClass =
    "p-2 rounded transition-colors bg-secondary hover:bg-secondary text-text-muted hover:text-text-primary";

  return (
    <PropertySection title="Boolean operations">
      <div className="flex gap-1">
        {OPS.map(({ op, label, Icon }) => (
          <Tooltip key={op}>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleOp(op)}
                >
                  <Icon size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>{label}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </PropertySection>
  );
}
