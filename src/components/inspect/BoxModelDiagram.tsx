import type { InspectData } from "@/lib/inspect/buildInspectData";
import type { InspectUnits } from "@/store/devModeStore";
import { formatLength } from "@/lib/inspect/units";

/**
 * CSS-box-model-style diagram with nested Border → Padding → content layers.
 * Purely presentational — all values are pre-computed pixel numbers from
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
  const fmtNumber = (px: number) => {
    const value = fmt(px);
    return value.endsWith(units) ? value.slice(0, -units.length) : value;
  };
  const fmtBorder = (px: number) => (px > 0 ? fmt(px) : "−");
  const hasPadding =
    box.paddingTop > 0 || box.paddingRight > 0 || box.paddingBottom > 0 || box.paddingLeft > 0;

  return (
    <div className="p-3">
      <div
        aria-label="Box model"
        className="relative h-[200px] overflow-hidden rounded-lg bg-surface-hover/30 p-6"
      >
        <div className="relative h-full rounded border border-border-default bg-surface-panel">
          <span className="absolute left-1/2 top-2 -translate-x-1/2 text-xs text-text-muted">Border</span>

          <span className="absolute left-6 top-2 text-xs text-text-muted">
            {fmtBorder(box.borderTop)}
          </span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
            {fmtBorder(box.borderRight)}
          </span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-muted">
            {fmtBorder(box.borderBottom)}
          </span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
            {fmtBorder(box.borderLeft)}
          </span>

          <div className="absolute inset-x-5 inset-y-8 rounded border border-text-primary bg-accent-selection">
            <span className="absolute left-3 top-1 text-xs text-text-muted">Padding</span>
            {hasPadding && (
              <>
                <span className="absolute left-1/2 top-1 -translate-x-1/2 text-xs text-text-muted">
                  {fmt(box.paddingTop)}
                </span>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-text-muted">
                  {fmt(box.paddingBottom)}
                </span>
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                  {fmt(box.paddingLeft)}
                </span>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                  {fmt(box.paddingRight)}
                </span>
              </>
            )}
            <div className="absolute left-1/2 top-1/2 flex min-w-[112px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border border-dashed border-text-primary bg-surface-panel px-3 py-1.5">
              <span className="whitespace-nowrap text-xs text-text-primary">
                {fmtNumber(box.width)} × {fmtNumber(box.height)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
