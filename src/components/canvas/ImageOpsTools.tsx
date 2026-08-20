import { useCallback, useState } from "react";
import { CircleNotch, MagicWandIcon, BezierCurveIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { OFFLINE_MESSAGE } from "@/lib/apiBase";
import { useCanRemoveBackground, useCanVectorize } from "./useImageOpsCapabilities";
import { resolveImageOpsTargetNodeId } from "@/lib/commands/imageOpsTarget";
import { runRemoveBackground, runVectorize } from "@/lib/commands/imageOpsActions";

// Kept in sync with the neighboring toolbar buttons in PrimitivesPanel.tsx
// (same variant/size/side, same icon size/weight) so this group reads as
// part of the same panel rather than a bolted-on extra.
const toolButtonBaseClass =
  "group relative size-9 p-0 rounded-lg! transition-none outline-none text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary";

type OpKind = "remove-background" | "vectorize";

/**
 * "Remove background" / "Vectorize" action buttons, shown in the tools
 * panel (PrimitivesPanel.tsx) when exactly one node with an image fill is
 * selected. Unlike every other button in that panel these are one-shot
 * actions, not draw-tool toggles — see toolDefinitions.ts's invariant note
 * on why they live outside ALL_TOOLS/LEADING_TOOLS/TRAILING_TOOLS, in the
 * same "contextual extras" zone as Layers3DToggle/SpeakerNotesCard.
 *
 * The two buttons appear independently: a backend that only has one image
 * op configured (canRemoveBackground()/canVectorize(), from the cached
 * GET /api/models response) only gets that one button.
 */
export function ImageOpsTools() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const nodesById = useSceneStore((s) => s.nodesById);
  const targetNodeId = resolveImageOpsTargetNodeId(nodesById, selectedIds);

  const removeBackgroundAvailable = useCanRemoveBackground();
  const vectorizeAvailable = useCanVectorize();

  const isReadOnly = useReadOnly();
  const isOnline = useOnlineStatus();

  const [runningOp, setRunningOp] = useState<OpKind | null>(null);

  const run = useCallback(
    (kind: OpKind, nodeId: string) => {
      if (runningOp) return;
      setRunningOp(kind);
      const promise = kind === "remove-background" ? runRemoveBackground(nodeId) : runVectorize(nodeId);
      promise
        .catch(() => {
          // Already reported to the user via toast.error inside the runner.
        })
        .finally(() => setRunningOp(null));
    },
    [runningOp],
  );

  if (!targetNodeId) return null;
  if (!removeBackgroundAvailable && !vectorizeAvailable) return null;

  // Same disabled condition on both buttons; only the label differs.
  const disabled = isReadOnly || !isOnline || runningOp !== null;
  const tooltipFor = (label: string) =>
    isReadOnly ? `${label} is disabled in view mode` : !isOnline ? OFFLINE_MESSAGE : label;

  return (
    <>
      {removeBackgroundAvailable && (
        <IconButton
          variant="ghost"
          size="lg"
          tooltip={tooltipFor("Remove background")}
          side="top"
          disabled={disabled}
          onClick={() => run("remove-background", targetNodeId)}
          className={toolButtonBaseClass}
        >
          {runningOp === "remove-background" ? (
            <CircleNotch size={40} className="size-6 animate-spin" weight="thin" />
          ) : (
            <MagicWandIcon size={40} className="size-6" weight="light" />
          )}
        </IconButton>
      )}
      {vectorizeAvailable && (
        <IconButton
          variant="ghost"
          size="lg"
          tooltip={tooltipFor("Vectorize")}
          side="top"
          disabled={disabled}
          onClick={() => run("vectorize", targetNodeId)}
          className={toolButtonBaseClass}
        >
          {runningOp === "vectorize" ? (
            <CircleNotch size={40} className="size-6 animate-spin" weight="thin" />
          ) : (
            <BezierCurveIcon size={40} className="size-6" weight="light" />
          )}
        </IconButton>
      )}
    </>
  );
}
