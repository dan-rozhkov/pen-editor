import { useState } from "react";
import {
  AlignBottom,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  AlignTop,
  GridNine,
  IconContext,
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
import { ButtonGroup } from "@/components/ui/button-group";
import { IconButton } from "@/components/ui/IconButton";

interface AlignmentSectionProps {
  count: number;
  selectedIds: string[];
  nodes: SceneNode[];
  parentFrame?: FrameNode | GroupNode | null;
}

export function AlignmentControls({
  count,
  selectedIds,
  nodes,
  parentFrame,
  showLabel = true,
}: AlignmentSectionProps & { showLabel?: boolean }) {
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

  return (
    <IconContext.Provider value={{ weight: "light" }}>
      <div className="flex flex-col gap-1">
        {showLabel && <div className="text-[10px] text-text-primary">Alignment</div>}
        <div className="flex w-full gap-2">
          <ButtonGroup orientation="horizontal" className="min-w-0 flex-1">
            <IconButton variant="secondary" size="sm" className="flex-1" onClick={() => handleAlign("left")} tooltip="Align left">
              <AlignLeft className="size-[18px]!" />
            </IconButton>
            <IconButton variant="secondary" size="sm" className="flex-1" onClick={() => handleAlign("centerH")} tooltip="Align center horizontally">
              <AlignCenterHorizontal className="size-[18px]!" />
            </IconButton>
            <IconButton variant="secondary" size="sm" className="flex-1" onClick={() => handleAlign("right")} tooltip="Align right">
              <AlignRight className="size-[18px]!" />
            </IconButton>
          </ButtonGroup>
          <ButtonGroup orientation="horizontal" className="min-w-0 flex-1">
            <IconButton variant="secondary" size="sm" className="flex-1" onClick={() => handleAlign("top")} tooltip="Align top">
              <AlignTop className="size-[18px]!" />
            </IconButton>
            <IconButton variant="secondary" size="sm" className="flex-1" onClick={() => handleAlign("centerV")} tooltip="Align center vertically">
              <AlignCenterVertical className="size-[18px]!" />
            </IconButton>
            <IconButton variant="secondary" size="sm" className="flex-1" onClick={() => handleAlign("bottom")} tooltip="Align bottom">
              <AlignBottom className="size-[18px]!" />
            </IconButton>
          </ButtonGroup>
          {!isSingleNodeInFrame && (
            <ButtonGroup orientation="horizontal" className="shrink-0">
              <IconButton variant="secondary" size="sm" onClick={handleTidyUp} tooltip="Tidy up (Ctrl+Alt+T)">
                <GridNine className="size-[18px]!" />
              </IconButton>
            </ButtonGroup>
          )}
        </div>
      </div>
    </IconContext.Provider>
  );
}

export function AlignmentSection(props: AlignmentSectionProps) {
  const isSingleNodeInFrame = props.count === 1 && props.parentFrame != null;

  return (
    <div className="flex flex-col gap-4">
      <PropertySection title="Alignment">
        <AlignmentControls {...props} showLabel={false} />
      </PropertySection>
      {!isSingleNodeInFrame && (
        <SpacingInput selectedIds={props.selectedIds} nodes={props.nodes} />
      )}
    </div>
  );
}

export function SpacingSection({ selectedIds, nodes }: Pick<AlignmentSectionProps, "selectedIds" | "nodes">) {
  return <SpacingInput selectedIds={selectedIds} nodes={nodes} />;
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
