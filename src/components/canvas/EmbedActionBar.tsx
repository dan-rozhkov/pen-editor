import { useCallback, useState } from "react";
import { PenNibIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { EmbedNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";

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
      } finally {
        setIsConverting(false);
      }
    },
    [isConverting, node.id],
  );

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
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-9 rounded-lg p-1"
        title="Inline edit"
        aria-label="Inline edit"
        onClick={handleInlineEdit}
      >
        <PencilSimpleLineIcon className="size-6" weight="light" />
      </Button>
      <div className="h-5 w-px bg-border" />
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-9 rounded-lg p-1"
        title="Convert to design"
        aria-label="Convert to design"
        onClick={handleConvertToDesign}
        disabled={isConverting}
      >
        <PenNibIcon className="size-6" weight="light" />
      </Button>
    </div>
  );
}
