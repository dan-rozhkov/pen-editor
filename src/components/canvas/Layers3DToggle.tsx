import { PerspectiveIcon } from "@/components/icons";
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
import { TOOL_STYLES, type ToolStyle } from "@/components/toolStyles";

export function Layers3DToggle({ toolStyle = TOOL_STYLES.floating }: { toolStyle?: ToolStyle } = {}) {
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
          className={`flex items-center justify-center ${toolStyle.buttonBase} ${toolStyle.inactive}`}
        >
          <PerspectiveIcon size={toolStyle.iconSize} className={toolStyle.icon} weight="light" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={toolStyle.tooltipSide}>Frame in 3D</TooltipContent>
    </Tooltip>
  );
}
