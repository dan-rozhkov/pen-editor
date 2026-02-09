import { useState } from "react";
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
} from "@phosphor-icons/react";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import {
  alignNodes,
  alignNodeInFrame,
  calculateSpacing,
  distributeSpacing,
  type AlignmentType,
} from "@/utils/alignmentUtils";
import type { FrameNode, GroupNode, SceneNode } from "@/types/scene";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Input } from "@/components/ui/input";

function applyUpdateRecursive(
  nodeList: SceneNode[],
  id: string,
  changes: Partial<SceneNode>,
): SceneNode[] {
  return nodeList.map((node) => {
    if (node.id === id) {
      return { ...node, ...changes } as SceneNode;
    }
    if (node.type === "frame" || node.type === "group") {
      return {
        ...node,
        children: applyUpdateRecursive(
          (node as FrameNode).children,
          id,
          changes,
        ),
      } as FrameNode;
    }
    return node;
  });
}

/** Save history, apply position updates, and set nodes */
function applyNodeUpdates(
  nodes: SceneNode[],
  updates: { id: string; x?: number; y?: number }[],
) {
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  let newNodes = nodes;
  for (const update of updates) {
    const { id, ...changes } = update;
    if (Object.keys(changes).length > 0) {
      newNodes = applyUpdateRecursive(newNodes, id, changes);
    }
  }
  useSceneStore.getState().setNodesWithoutHistory(newNodes);
}

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

  const iconSize = 16;
  const buttonBaseClass = "p-2 rounded transition-colors";
  const buttonClass = `${buttonBaseClass} bg-surface-elevated hover:bg-surface-hover text-text-muted hover:text-text-primary`;

  return (
    <div className="flex flex-col gap-4">
      <PropertySection title="Alignment">
        <div className="flex gap-1">
          <button
            className={buttonClass}
            onClick={() => handleAlign("left")}
            title="Align left"
          >
            <TextAlignLeft size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("centerH")}
            title="Align center horizontally"
          >
            <TextAlignCenter size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("right")}
            title="Align right"
          >
            <TextAlignRight size={iconSize} />
          </button>
          <div className="w-2" />
          <button
            className={buttonClass}
            onClick={() => handleAlign("top")}
            title="Align top"
          >
            <AlignTop size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("centerV")}
            title="Align center vertically"
          >
            <AlignCenterVertical size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("bottom")}
            title="Align bottom"
          >
            <AlignBottom size={iconSize} />
          </button>
        </div>
      </PropertySection>
      {!isSingleNodeInFrame && (
        <>
          <SpacingInput
            selectedIds={selectedIds}
            nodes={nodes}
          />
          <div className="text-text-muted text-xs text-center">
            {count} layers selected
          </div>
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
