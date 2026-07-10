import { CircleHalf, Diamond, DiamondsFour, Minus } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { FlatFrameNode, SceneNode } from "@/types/scene";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TypeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  typeLabelOverride?: string;
  slotNode?: FlatFrameNode | null;
}

export function TypeSection({ node, onUpdate, typeLabelOverride, slotNode }: TypeSectionProps) {
  const detachInstance = useSceneStore((s) => s.detachInstance);
  const toggleSlot = useSceneStore((s) => s.toggleSlot);
  const setSelectedIds = useSelectionStore((s) => s.setSelectedIds);
  const typeLabel = typeLabelOverride ?? (node.type === "ref" ? "Instance" : node.type);
  const isContainerType = node.type === "frame" || node.type === "group";
  const isFrame = node.type === "frame";
  const isInstance = node.type === "ref";
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
            {isFrame && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => {
                        onUpdate({
                          reusable: !node.reusable,
                        } as Partial<SceneNode>);
                      }}
                      aria-label={node.reusable ? "Detach Component" : "Create Component"}
                      className="p-1 rounded hover:bg-secondary text-text-primary transition-colors relative"
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
                  }
                />
                <TooltipContent>
                  <span>{node.reusable ? "Detach Component" : "Create Component"}</span>
                </TooltipContent>
              </Tooltip>
            )}
            {maskButton}
          </>
        ) : (
          <>
            <div className="text-xs text-text-secondary capitalize flex-1">
              {typeLabel}
            </div>
            {maskButton}
            {isInstance && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => {
                        const detachedId = detachInstance(node.id);
                        if (detachedId) {
                          setSelectedIds([detachedId]);
                        }
                      }}
                      aria-label="Detach Instance"
                      className="p-1 rounded hover:bg-secondary text-text-primary transition-colors relative"
                    >
                      <Diamond size={16} />
                      <Minus size={8} weight="bold" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </button>
                  }
                />
                <TooltipContent>
                  <span>Detach Instance</span>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
      {slotNode && (
        <div className="mt-3">
          <Label className="cursor-pointer">
            <Checkbox
              checked={!!slotNode.isSlot}
              onCheckedChange={() => toggleSlot(slotNode.id)}
            />
            Mark as slot
          </Label>
        </div>
      )}
    </PropertySection>
  );
}
