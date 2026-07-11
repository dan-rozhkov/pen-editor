import { PerspectiveIcon } from "@phosphor-icons/react";
import { useLayers3DStore } from "@/store/layers3dStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { resolveTargetFrame } from "@/pixi/layers3d/resolveTargetFrame";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Layers3DToggle() {
  const active = useLayers3DStore((s) => s.active);
  const enter = useLayers3DStore((s) => s.enter);
  const exit = useLayers3DStore((s) => s.exit);

  // Subscribed so the button re-renders when the resolved target frame
  // could change — resolveTargetFrame() itself reads store state
  // untracked, so without these subscriptions the disabled state would
  // only refresh via incidental re-renders elsewhere.
  useSelectionStore((s) => s.selectedIds);
  useSceneStore((s) => s.rootIds);

  const target = resolveTargetFrame();
  const disabled = !active && target === null;

  const onClick = () => {
    if (active) {
      exit();
      return;
    }
    const frameId = resolveTargetFrame();
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
