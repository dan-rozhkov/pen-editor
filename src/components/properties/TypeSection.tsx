import { CircleHalf } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import type { SceneNode } from "@/types/scene";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TypeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function TypeSection({ node, onUpdate }: TypeSectionProps) {
  const typeLabel = node.type;
  const isContainerType = node.type === "frame" || node.type === "group";
  const canUseAsMask = node.type !== "connector";
  const maskButton = canUseAsMask ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "shrink-0 flex items-center justify-center w-6 h-6 rounded border border-transparent",
              node.isMask
                ? "border-border-default bg-surface-panel text-text-primary hover:bg-surface-panel"
                : "text-text-primary hover:bg-secondary"
            )}
            aria-label={node.isMask ? "Disable mask" : "Use as mask"}
            aria-pressed={node.isMask === true}
            onClick={() => onUpdate({ isMask: !node.isMask } as Partial<SceneNode>)}
          >
            <CircleHalf size={18} weight="light" />
          </button>
        }
      />
      <TooltipContent>
        <span>{node.isMask ? "Disable mask" : "Use as mask"}</span>
      </TooltipContent>
    </Tooltip>
  ) : null;

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
            {maskButton}
          </>
        ) : (
          <>
            <div className="text-xs text-text-secondary capitalize flex-1">
              {typeLabel}
            </div>
            {maskButton}
          </>
        )}
      </div>
    </PropertySection>
  );
}
