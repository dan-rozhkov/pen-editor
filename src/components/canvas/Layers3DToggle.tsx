import { PerspectiveIcon } from "@phosphor-icons/react";
import { useLayers3DStore } from "@/store/layers3dStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import {
  resolveTargetFrame,
  resolveTargetFrameFromState,
} from "@/pixi/layers3d/resolveTargetFrame";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Layers3DToggle() {
  const active = useLayers3DStore((s) => s.active);
  const enter = useLayers3DStore((s) => s.enter);
  const exit = useLayers3DStore((s) => s.exit);

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const target = useSceneStore((s) =>
    resolveTargetFrame(s.nodesById, s.parentById, s.rootIds, selectedIds),
  );
  const disabled = !active && target === null;

  const onClick = () => {
    if (active) {
      exit();
      return;
    }
    const frameId = resolveTargetFrameFromState();
    if (frameId) void enter(frameId);
  };

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        <button
          type="button"
          aria-label="Frame in 3D"
          disabled={disabled}
          onClick={onClick}
          className="flex size-9 items-center justify-center rounded-lg text-text-primary transition-none outline-none hover:bg-secondary hover:text-text-primary dark:hover:bg-secondary"
        >
          <PerspectiveIcon size={24} weight="light" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Frame in 3D</TooltipContent>
    </Tooltip>
  );
}
