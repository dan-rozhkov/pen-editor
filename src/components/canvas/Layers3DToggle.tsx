import { Cube } from "@phosphor-icons/react";
import { useLayers3DStore } from "@/store/layers3dStore";
import { resolveTargetFrame } from "@/pixi/layers3d/resolveTargetFrame";

export function Layers3DToggle() {
  const active = useLayers3DStore((s) => s.active);
  const enter = useLayers3DStore((s) => s.enter);
  const exit = useLayers3DStore((s) => s.exit);

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
    <button
      type="button"
      aria-label="3D layer view"
      title={disabled ? "Select a frame to view in 3D" : "3D layer view"}
      disabled={disabled}
      onClick={onClick}
      className={`absolute left-1/2 top-4 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-accent-primary text-white"
          : "bg-surface-panel text-text-primary"
      }`}
    >
      <Cube weight="bold" />
      3D
    </button>
  );
}
