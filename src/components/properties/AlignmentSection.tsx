import { useState } from "react";
import {
  AlignBottomIcon,
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  GridNineIcon,
  IconContext,
} from "@/components/icons";
import {
  alignNodes,
  alignNodeInFrame,
  calculateSpacing,
  distributeSpacing,
  tidyUpNodes,
  type AlignmentType,
} from "@/utils/alignmentUtils";
import { applyNodeUpdates } from "@/utils/applyNodeUpdates";
import type { FlatFrameNode, FlatGroupNode, FrameNode, GroupNode, SceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Input } from "@/components/ui/input";
import { SegmentedGroup, segmentedActionClass } from "@/components/ui/segmented-control";
import { IconButton } from "@/components/ui/IconButton";

interface AlignmentControlsProps {
  count: number;
  selectedIds: string[];
  parentFrame?: FrameNode | GroupNode | FlatFrameNode | FlatGroupNode | null;
  showLabel?: boolean;
}

interface AlignmentSectionProps extends Omit<AlignmentControlsProps, "showLabel"> {
  nodes: SceneNode[];
}

export function AlignmentControls({
  count,
  selectedIds,
  parentFrame,
  showLabel = true,
}: AlignmentControlsProps) {
  const isSingleNodeInFrame = count === 1 && parentFrame != null;

  const handleAlign = (alignment: AlignmentType) => {
    // Tree is read imperatively at event time — a subscription here would
    // re-render the properties panel on every scene mutation.
    const nodes = useSceneStore.getState().getNodes();
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
    const nodes = useSceneStore.getState().getNodes();
    const updates = tidyUpNodes(selectedIds, nodes);
    if (updates.length === 0) return;
    applyNodeUpdates(nodes, updates);
  };

  return (
    <IconContext.Provider value={{ weight: "light" }}>
      <div className="flex flex-col gap-1">
        {showLabel && <div className="text-[10px] text-text-primary">Alignment</div>}
        <div className="flex w-full gap-2">
          <SegmentedGroup className="min-w-0 flex-1" aria-label="Align horizontally">
            <IconButton variant="ghost" size="sm" className={segmentedActionClass({ icon: true, className: "flex-1" })} onClick={() => handleAlign("left")} tooltip="Align left">
              <AlignLeftIcon />
            </IconButton>
            <IconButton variant="ghost" size="sm" className={segmentedActionClass({ icon: true, className: "flex-1" })} onClick={() => handleAlign("centerH")} tooltip="Align center horizontally">
              <AlignCenterHorizontalIcon />
            </IconButton>
            <IconButton variant="ghost" size="sm" className={segmentedActionClass({ icon: true, className: "flex-1" })} onClick={() => handleAlign("right")} tooltip="Align right">
              <AlignRightIcon />
            </IconButton>
          </SegmentedGroup>
          <SegmentedGroup className="min-w-0 flex-1" aria-label="Align vertically">
            <IconButton variant="ghost" size="sm" className={segmentedActionClass({ icon: true, className: "flex-1" })} onClick={() => handleAlign("top")} tooltip="Align top">
              <AlignTopIcon />
            </IconButton>
            <IconButton variant="ghost" size="sm" className={segmentedActionClass({ icon: true, className: "flex-1" })} onClick={() => handleAlign("centerV")} tooltip="Align center vertically">
              <AlignCenterVerticalIcon />
            </IconButton>
            <IconButton variant="ghost" size="sm" className={segmentedActionClass({ icon: true, className: "flex-1" })} onClick={() => handleAlign("bottom")} tooltip="Align bottom">
              <AlignBottomIcon />
            </IconButton>
          </SegmentedGroup>
          {!isSingleNodeInFrame && (
            <IconButton
              variant="ghost"
              size="icon-sm"
              className="shrink-0 self-center text-text-muted [&_svg]:size-4"
              onClick={handleTidyUp}
              tooltip="Tidy up (Ctrl+Alt+T)"
            >
              <GridNineIcon />
            </IconButton>
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
        <AlignmentControls
          count={props.count}
          selectedIds={props.selectedIds}
          parentFrame={props.parentFrame}
          showLabel={false}
        />
      </PropertySection>
      {!isSingleNodeInFrame && (
        <SpacingInput selectedIds={props.selectedIds} nodes={props.nodes} />
      )}
    </div>
  );
}

export function SpacingSection({ selectedIds }: { selectedIds: string[] }) {
  // Own tree subscription: this branch renders only in multi-select mode, so
  // the broad getNodes() subscription stays isolated from the single-select
  // panel path (calculateSpacing needs absolute positions from the tree).
  const nodes = useSceneStore((s) => s.getNodes());
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
