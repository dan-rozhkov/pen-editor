import { useState } from "react";
import {
  AlignBottom,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  AlignTop,
  GridNine,
} from "@phosphor-icons/react";
import {
  alignNodes,
  alignNodeInFrame,
  calculateSpacing,
  distributeSpacing,
  tidyUpNodes,
  type AlignmentType,
} from "@/utils/alignmentUtils";
import { applyNodeUpdates } from "@/utils/applyNodeUpdates";
import type { FrameNode, GroupNode, SceneNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface AlignmentSectionProps {
  count: number;
  selectedIds: string[];
  nodes: SceneNode[];
  parentFrame?: FrameNode | GroupNode | null;
}

export function AlignmentSection({
  count,
  selectedIds,
  nodes,
  parentFrame,
}: AlignmentSectionProps) {
  const isSingleNodeInFrame = count === 1 && parentFrame != null;

  const handleAlign = (alignment: AlignmentType) => {
    let updates: { id: string; x?: number; y?: number }[];

    if (isSingleNodeInFrame) {
      const update = alignNodeInFrame(nodes, selectedIds[0], parentFrame, alignment);
      updates = update ? [update] : [];
    } else {
      updates = alignNodes(selectedIds, nodes, alignment);
    }

    if (updates.length === 0) return;
    applyNodeUpdates(nodes, updates);
  };

  const handleTidyUp = () => {
    const updates = tidyUpNodes(selectedIds, nodes);
    if (updates.length === 0) return;
    applyNodeUpdates(nodes, updates);
  };

  const iconSize = 16;
  const buttonBaseClass = "p-2 rounded transition-colors";
  const buttonClass = `${buttonBaseClass} bg-secondary hover:bg-secondary text-text-muted hover:text-text-primary`;

  return (
    <div className="flex flex-col gap-4">
      <PropertySection title="Alignment">
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleAlign("left")}
                  aria-label="Align left"
                >
                  <AlignLeft size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>Align left</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleAlign("centerH")}
                  aria-label="Align center horizontally"
                >
                  <AlignCenterHorizontal size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>Align center horizontally</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleAlign("right")}
                  aria-label="Align right"
                >
                  <AlignRight size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>Align right</span>
            </TooltipContent>
          </Tooltip>
          <div className="w-2" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleAlign("top")}
                  aria-label="Align top"
                >
                  <AlignTop size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>Align top</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleAlign("centerV")}
                  aria-label="Align center vertically"
                >
                  <AlignCenterVertical size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>Align center vertically</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={buttonClass}
                  onClick={() => handleAlign("bottom")}
                  aria-label="Align bottom"
                >
                  <AlignBottom size={iconSize} />
                </button>
              }
            />
            <TooltipContent>
              <span>Align bottom</span>
            </TooltipContent>
          </Tooltip>
          {!isSingleNodeInFrame && (
            <>
              <div className="w-2" />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className={buttonClass}
                      onClick={handleTidyUp}
                      aria-label="Tidy up (Ctrl+Alt+T)"
                    >
                      <GridNine size={iconSize} />
                    </button>
                  }
                />
                <TooltipContent>
                  <span>Tidy up (Ctrl+Alt+T)</span>
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </PropertySection>
      {!isSingleNodeInFrame && (
        <>
          <SpacingInput
            selectedIds={selectedIds}
            nodes={nodes}
          />
        </>
      )}
    </div>
  );
}

function SpacingInput({
  selectedIds,
  nodes,
}: {
  selectedIds: string[];
  nodes: SceneNode[];
}) {
  const spacing = calculateSpacing(selectedIds, nodes);
  const [localValue, setLocalValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  if (spacing === null) return null;

  const displayValue = isFocused
    ? localValue
    : spacing === "mixed"
    ? ""
    : String(Math.round(spacing));
  const placeholder = spacing === "mixed" ? "mixed" : undefined;

  const handleApply = (inputValue: string) => {
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed)) return;
    const val = Math.max(0, parsed);

    const updates = distributeSpacing(selectedIds, nodes, val);
    if (updates.length === 0) return;
    applyNodeUpdates(nodes, updates);
  };

  return (
    <PropertySection title="Spacing">
      <div className="flex-1">
        <Input
          type="text"
          inputMode="numeric"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            setLocalValue(
              spacing === "mixed" ? "" : String(Math.round(spacing as number)),
            );
          }}
          onBlur={(e) => {
            setIsFocused(false);
            handleApply(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleApply((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
    </PropertySection>
  );
}
