import type { InspectData } from "@/lib/inspect/buildInspectData";
import type { InspectUnits } from "@/store/devModeStore";
import { formatLength } from "@/lib/inspect/units";

/**
 * CSS-box-model-style diagram: an outer ring showing padding on each side
 * (when non-zero) around an inner box labeled with width x height. Purely
 * presentational — all values are pre-computed pixel numbers from
 * `InspectData.box`, formatted here per the current unit preference.
 */
export function BoxModelDiagram({
  box,
  units,
  remBase,
}: {
  box: InspectData["box"];
  units: InspectUnits;
  remBase: number;
}) {
  const fmt = (px: number) => formatLength(px, units, remBase);
  const hasPadding =
    box.paddingTop > 0 || box.paddingRight > 0 || box.paddingBottom > 0 || box.paddingLeft > 0;

  return (
    <div className="p-3">
      <div className="relative h-[120px] flex items-center justify-center rounded-md border border-dashed border-border-default bg-surface-hover/40">
        {hasPadding && (
          <>
            <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-mono text-text-muted">
              {fmt(box.paddingTop)}
            </span>
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-mono text-text-muted">
              {fmt(box.paddingBottom)}
            </span>
            <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-muted">
              {fmt(box.paddingLeft)}
            </span>
            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-mono text-text-muted">
              {fmt(box.paddingRight)}
            </span>
          </>
        )}
        <div className="flex flex-col items-center justify-center gap-0.5 min-w-[60px] min-h-[40px] rounded border border-green-500/50 bg-green-500/10 px-3 py-2">
          <span className="font-mono text-xs text-text-primary">{fmt(box.width)}</span>
          <span className="text-text-muted text-[10px]">×</span>
          <span className="font-mono text-xs text-text-primary">{fmt(box.height)}</span>
        </div>
      </div>
      {box.gap !== undefined && (
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-text-muted text-xs">Gap</span>
          <span className="font-mono text-xs text-text-primary">{fmt(box.gap)}</span>
        </div>
      )}
    </div>
  );
}
