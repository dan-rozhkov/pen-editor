import { useMemo } from "react";
import type { InspectData } from "@/lib/inspect/buildInspectData";
import type { InspectUnits } from "@/store/devModeStore";
import { formatLength } from "@/lib/inspect/units";

type Corner = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
const DIAGRAM_CORNER_RADIUS = 12;

function RadiusCorner({ corner }: { corner: Corner }) {
  const size = 16;
  const className = {
    topLeft: "left-0 top-0 border-l border-t",
    topRight: "right-0 top-0 border-r border-t",
    bottomRight: "bottom-0 right-0 border-b border-r",
    bottomLeft: "bottom-0 left-0 border-b border-l",
  }[corner];
  const borderRadius = {
    topLeft: { borderTopLeftRadius: `${DIAGRAM_CORNER_RADIUS}px` },
    topRight: { borderTopRightRadius: `${DIAGRAM_CORNER_RADIUS}px` },
    bottomRight: { borderBottomRightRadius: `${DIAGRAM_CORNER_RADIUS}px` },
    bottomLeft: { borderBottomLeftRadius: `${DIAGRAM_CORNER_RADIUS}px` },
  }[corner];

  return (
    <span
      aria-hidden="true"
      className={`absolute border-text-primary ${className}`}
      style={{ width: size, height: size, ...borderRadius }}
    />
  );
}

function TextMetricsDiagram({
  text,
  box,
  formatValue,
}: {
  text: NonNullable<InspectData["textMetrics"]>;
  box: InspectData["box"];
  formatValue: (value: number) => string;
}) {
  const metrics = useMemo(() => {
    const preview = text.text.trim().slice(0, 2) || "Ag";
    const fallbackWidth = text.fontSize * 1.15;
    if (typeof document === "undefined") {
      return { preview, width: fallbackWidth };
    }
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return { preview, width: fallbackWidth };
    context.font = `${text.fontStyle} ${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`;
    const measured = context.measureText(preview);
    return { preview, width: measured.width || fallbackWidth };
  }, [text]);

  const previewWidth = Math.min(metrics.width, box.width);
  const leftGap =
    text.textAlign === "right"
      ? box.width - previewWidth
      : text.textAlign === "center"
        ? (box.width - previewWidth) / 2
        : 0;
  const rightGap = Math.max(0, box.width - previewWidth - leftGap);
  const previewScale = Math.min(1, 106 / Math.max(text.fontSize, 1));

  return (
    <div className="p-3">
      <div aria-label="Text metrics" className="relative h-[200px] overflow-hidden bg-surface-hover/30 p-6">
        <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[12px] bg-surface-panel">
          <div className="relative flex h-[108px] w-[168px] items-center justify-center border border-blue-500">
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-blue-500" />
            <div
              className="relative border border-dashed border-red-500 px-2 leading-none text-text-primary"
              style={{
                fontFamily: text.fontFamily,
                fontSize: `${Math.max(18, text.fontSize * previewScale)}px`,
                fontStyle: text.fontStyle,
                fontWeight: text.fontWeight,
              }}
            >
              {metrics.preview}
            </div>
            <span className="absolute -left-2 top-1/2 -translate-x-full -translate-y-1/2 rounded bg-orange-500 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatValue(leftGap)}
            </span>
            <span className="absolute -right-2 top-1/2 translate-x-full -translate-y-1/2 rounded bg-orange-500 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatValue(rightGap)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * CSS-box-model-style diagram with nested Border → Padding → content layers.
 * Purely presentational — all values are pre-computed pixel numbers from
 * `InspectData.box`, formatted here per the current unit preference.
 */
export function BoxModelDiagram({
  box,
  textMetrics,
  units,
  remBase,
}: {
  box: InspectData["box"];
  textMetrics?: InspectData["textMetrics"];
  units: InspectUnits;
  remBase: number;
}) {
  const fmt = (px: number) => formatLength(px, units, remBase);
  const fmtNumber = (px: number) => {
    const value = fmt(px);
    return value.endsWith(units) ? value.slice(0, -units.length) : value;
  };
  const fmtBorder = (px: number) => (px > 0 ? fmtNumber(px) : "−");
  const hasPadding =
    box.paddingTop > 0 || box.paddingRight > 0 || box.paddingBottom > 0 || box.paddingLeft > 0;
  const radius = box.cornerRadius;
  const hasRadius = radius && Object.values(radius).some((value) => value > 0);
  const borderLabelLeft = hasRadius ? 48 : undefined;

  if (textMetrics) {
    return <TextMetricsDiagram text={textMetrics} box={box} formatValue={fmt} />;
  }

  return (
    <div className="p-3">
      <div
        aria-label="Box model"
        className="relative h-[200px] overflow-hidden bg-surface-hover/30 p-6"
      >
        <div className="relative h-full overflow-hidden rounded-[12px] bg-surface-panel">
          {hasRadius && radius && (
            <>
              <RadiusCorner corner="topLeft" />
              <RadiusCorner corner="topRight" />
              <RadiusCorner corner="bottomRight" />
              <RadiusCorner corner="bottomLeft" />
              <span className="absolute left-2 top-2 text-xs leading-none text-text-muted">
                {fmtNumber(radius.topLeft)}
              </span>
              <span className="absolute right-2 top-2 text-xs leading-none text-text-muted">
                {fmtNumber(radius.topRight)}
              </span>
              <span className="absolute bottom-2 left-2 text-xs leading-none text-text-muted">
                {fmtNumber(radius.bottomLeft)}
              </span>
              <span className="absolute bottom-2 right-2 text-xs leading-none text-text-muted">
                {fmtNumber(radius.bottomRight)}
              </span>
            </>
          )}
          <span
            className={
              borderLabelLeft
                ? "absolute top-2 text-xs text-text-muted"
                : "absolute left-8 top-2 -translate-x-1/2 text-xs text-text-muted"
            }
            style={borderLabelLeft ? { left: borderLabelLeft } : undefined}
          >
            Border
          </span>

          <span className="absolute left-1/2 top-2 text-xs text-text-muted">
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
                  {fmtNumber(box.paddingTop)}
                </span>
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-text-muted">
                  {fmtNumber(box.paddingBottom)}
                </span>
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                  {fmtNumber(box.paddingLeft)}
                </span>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">
                  {fmtNumber(box.paddingRight)}
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
