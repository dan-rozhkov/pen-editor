import { useCallback, useState } from "react";
import { PenNibIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { IconButton } from "@/components/ui/IconButton";
import type { EmbedNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useEditorModeStore, canEditScene } from "@/store/editorModeStore";

interface EmbedActionBarProps {
  node: EmbedNode;
  absoluteX: number;
  absoluteY: number;
}

export function EmbedActionBar({
  node,
  absoluteX,
  absoluteY,
}: EmbedActionBarProps) {
  const [isConverting, setIsConverting] = useState(false);
  const editorMode = useEditorModeStore((s) => s.mode);
  const scale = useViewportStore((s) => s.scale);
  const panX = useViewportStore((s) => s.x);
  const panY = useViewportStore((s) => s.y);
  const dpr = window.devicePixelRatio || 1;

  const screenX = Math.round((absoluteX * scale + panX) * dpr) / dpr;
  const screenY = Math.round((absoluteY * scale + panY) * dpr) / dpr;
  const screenWidth = Math.round(node.width * scale * dpr) / dpr;

  const stopCanvasPointer = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleInlineEdit = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      useSelectionStore.getState().startEditing(node.id, "embed");
    },
    [node.id],
  );

  const handleConvertToDesign = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isConverting) return;
      setIsConverting(true);
      try {
        const newFrameId = await useSceneStore.getState().convertEmbedToDesign(node.id);
        if (newFrameId) {
          useSelectionStore.getState().setSelectedIds([newFrameId]);
        }
      } catch (error) {
        console.error("Failed to convert embed to design:", error);
        toast.error("Couldn't convert this embed to a design — please try again.");
      } finally {
        setIsConverting(false);
      }
    },
    [isConverting, node.id],
  );

  // The action bar only offers editing affordances (inline edit, convert) —
  // hide it entirely in read-only view/present modes.
  if (!canEditScene(editorMode)) return null;

  return (
    <div
      className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-border bg-surface-panel/95 p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
      style={{
        left: screenX + screenWidth / 2,
        top: screenY,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
      onPointerDown={stopCanvasPointer}
    >
      <IconButton
        tooltip="Inline edit"
        side="top"
        variant="ghost"
        size="icon-sm"
        className="size-9 rounded-lg p-1"
        onClick={handleInlineEdit}
      >
        <PencilSimpleLineIcon className="size-6" weight="light" />
      </IconButton>
      <div className="h-5 w-px bg-border" />
      <IconButton
        tooltip="Convert to design"
        side="top"
        variant="ghost"
        size="icon-sm"
        className="size-9 rounded-lg p-1"
        onClick={handleConvertToDesign}
        disabled={isConverting}
      >
        <PenNibIcon className="size-6" weight="light" />
      </IconButton>
    </div>
  );
}
