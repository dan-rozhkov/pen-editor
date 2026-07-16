import { useState } from "react";
import clsx from "clsx";
import { generateId, type GradientFill, type LineCapShape, type LineNode, type Paint, type PathStroke, type PerSideStroke, type SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowDown, ArrowUp, Eye, EyeSlash, MinusIcon, PlusIcon, DotsSixVertical } from "@phosphor-icons/react";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";
import { GradientEditor } from "@/components/properties/GradientEditor";
import {
  BlendModeDropdown,
  FILL_ROW_TRIGGER_CLASS,
  PaintSwatch,
} from "@/components/properties/FillSection";
import { clearLegacyStrokeProps } from "@/utils/fillUtils";
import { getDefaultGradient } from "@/utils/gradientUtils";
import {
  convertFillKind,
  getFillKind,
  moveItem,
  paintSummary,
  removeFillAt,
  toggleFillVisibleAt,
  updateFillAt,
  type FillKind,
} from "@/components/properties/fillSectionUtils";

// Strokes intentionally support only solid/linear/radial paints (no image/
// pattern/video — out of scope, see task spec p1-22 "За скоупом").
const STROKE_TYPE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
];

interface StrokeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  component: SceneNode | null;
  colorVariables: Variable[];
  activeTheme: ThemeName;
  isOverridden: <T>(instanceVal: T | undefined, componentVal: T | undefined) => boolean;
  resetOverride: (property: keyof SceneNode) => void;
  mixedKeys?: Set<string>;
}

type StrokeMode = "unified" | "per-side";

const CAP_OPTIONS = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "triangle", label: "Triangle" },
  { value: "circle", label: "Circle" },
  { value: "bar", label: "Bar" },
];

function getStrokeMode(node: SceneNode): StrokeMode {
  const perSide = node.strokeWidthPerSide;
  if (perSide && (perSide.top != null || perSide.right != null || perSide.bottom != null || perSide.left != null)) {
    return "per-side";
  }
  return "unified";
}

export function StrokeSection({
  node,
  onUpdate,
  component,
  colorVariables,
  activeTheme,
  isOverridden,
  resetOverride,
  mixedKeys,
}: StrokeSectionProps) {
  const pathStroke: PathStroke | undefined = node.type === "path" ? node.pathStroke : undefined;

  // Paint-stack mode: only entered once `strokes` is explicitly set (e.g. via
  // "Add gradient" below), so nodes that only ever used the legacy single
  // `stroke` field keep rendering/behaving exactly as before.
  const strokes = node.strokes;
  const usesStack = !!strokes;
  const hasGradientInStack = !!strokes?.some((p) => p.type === "gradient");

  const hasStroke = !!(
    node.stroke ||
    usesStack ||
    (node.strokeWidth && node.strokeWidth > 0) ||
    (node.strokeWidthPerSide &&
      (node.strokeWidthPerSide.top != null ||
        node.strokeWidthPerSide.right != null ||
        node.strokeWidthPerSide.bottom != null ||
        node.strokeWidthPerSide.left != null)) ||
    pathStroke
  );

  // Wrap onUpdate to migrate pathStroke to BaseNode properties on first edit
  const effectiveOnUpdate = (updates: Partial<SceneNode>) => {
    if (pathStroke && !node.stroke && !node.strokeWidth) {
      onUpdate({
        stroke: pathStroke.fill ?? "#000000",
        strokeWidth: pathStroke.thickness ?? 1,
        strokeAlign: (pathStroke.align as 'center' | 'inside' | 'outside') ?? "center",
        pathStroke: undefined,
        ...updates,
      } as Partial<SceneNode>);
    } else {
      onUpdate(updates);
    }
  };

  const strokeMode = getStrokeMode(node);
  const legacyStrokePaint: Paint = {
    id: "legacy-stroke",
    type: "solid",
    color: node.stroke ?? pathStroke?.fill ?? component?.stroke ?? "#000000",
    opacity: node.strokeOpacity,
  };

  // Per-side stroke doesn't make sense for ellipses
  const canUsePerSide = node.type !== "ellipse";

  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      effectiveOnUpdate({ strokeBinding: { variableId } });
    } else {
      effectiveOnUpdate({ strokeBinding: undefined });
    }
  };

  const handleAddStroke = () => {
    effectiveOnUpdate({ stroke: "#000000", strokeWidth: 1 });
  };

  const handleRemoveStroke = () => {
    const removeUpdates: Partial<SceneNode> = {
      stroke: undefined,
      strokes: undefined,
      strokeWidth: undefined,
      strokeAlign: undefined,
      strokeBinding: undefined,
      strokeOpacity: undefined,
      strokeWidthPerSide: undefined,
    } as Partial<SceneNode>;
    if (node.type === "path") {
      (removeUpdates as Record<string, unknown>).pathStroke = undefined;
    }
    onUpdate(removeUpdates);
  };

  /** Commit a new stroke paint stack, clearing legacy single-stroke fields. */
  const commitStack = (next: Paint[]) => {
    onUpdate({ strokes: next, ...clearLegacyStrokeProps() } as Partial<SceneNode>);
  };

  /**
   * Convert the current single legacy stroke into a paint stack — the entry
   * point into stack mode. Only reachable from the "Type" selector's
   * linear/radial options (see the non-stack color row below), so a plain
   * solid stroke node's behavior/tests are unaffected until the user
   * explicitly asks for a gradient.
   */
  const handleConvertToGradient = (gradientType: "linear" | "radial") => {
    const currentColor = node.stroke ?? pathStroke?.fill ?? "#000000";
    const gradient: GradientFill = {
      ...getDefaultGradient(gradientType),
      stops: [
        { color: currentColor, position: 0 },
        { color: "#000000", position: 1 },
      ],
    };
    commitStack([{ id: generateId(), type: "gradient", gradient }]);
  };

  const handleModeChange = (mode: string) => {
    // Per-side + gradient is out of scope (ambiguous geometry) — blocked by
    // omitting "Per Side" from the options below when a gradient paint is
    // present, but guard here too in case a stale value slips through.
    if (mode === "per-side" && hasGradientInStack) return;
    if (mode === "per-side") {
      // Switch to per-side: copy current strokeWidth to all sides
      const currentWidth = node.strokeWidth ?? pathStroke?.thickness ?? 1;
      effectiveOnUpdate({
        strokeWidthPerSide: {
          top: currentWidth,
          right: currentWidth,
          bottom: currentWidth,
          left: currentWidth,
        },
        strokeWidth: undefined,
      } as Partial<SceneNode>);
    } else {
      // Switch to unified: use max of all sides
      const perSide = node.strokeWidthPerSide;
      const maxWidth = Math.max(
        perSide?.top ?? 0,
        perSide?.right ?? 0,
        perSide?.bottom ?? 0,
        perSide?.left ?? 0,
        1
      );
      effectiveOnUpdate({
        strokeWidth: maxWidth,
        strokeWidthPerSide: undefined,
      } as Partial<SceneNode>);
    }
  };

  const handlePerSideChange = (side: keyof PerSideStroke, value: number) => {
    effectiveOnUpdate({
      strokeWidthPerSide: {
        ...node.strokeWidthPerSide,
        [side]: value,
      },
    } as Partial<SceneNode>);
  };

  return (
    <PropertySection
      title="Stroke"
      action={
        !hasStroke ? (
          <IconButton variant="ghost" size="icon-sm" tooltip="Add stroke" onClick={handleAddStroke}>
            <PlusIcon />
          </IconButton>
        ) : (
          <IconButton variant="ghost" size="icon-sm" tooltip="Remove stroke" onClick={handleRemoveStroke}>
            <MinusIcon />
          </IconButton>
        )
      }
    >
      {hasStroke && (
        <>
          {usesStack ? (
            <StrokePaintStack
              strokes={strokes!}
              commit={commitStack}
              colorVariables={colorVariables}
              activeTheme={activeTheme}
              canUseGradient={strokeMode !== "per-side"}
            />
          ) : (
          /* Keep the legacy single-stroke controls compact, matching Fill's
             swatch-and-summary row. Its type picker lives in the popover. */
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger className={FILL_ROW_TRIGGER_CLASS} title="Edit stroke">
                <PaintSwatch paint={legacyStrokePaint} />
                <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                  {mixedKeys?.has("stroke") ? "Mixed" : paintSummary(legacyStrokePaint)}
                </span>
              </PopoverTrigger>
              <PopoverContent
                draggable
                dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Stroke</span>}
              >
                <SelectInput
                  label="Type"
                  labelOutside
                  value="solid"
                  options={
                    strokeMode === "per-side"
                      ? [{ value: "solid", label: "Solid" }]
                      : STROKE_TYPE_OPTIONS
                  }
                  onChange={(v) => {
                    if (v === "linear" || v === "radial") handleConvertToGradient(v);
                  }}
                />
                <ColorInput
                  value={node.stroke ?? pathStroke?.fill ?? component?.stroke ?? "#000000"}
                  onChange={(v) => effectiveOnUpdate({ stroke: v || undefined })}
                  variableId={node.strokeBinding?.variableId}
                  onVariableChange={handleStrokeVariableChange}
                  availableVariables={colorVariables}
                  activeTheme={activeTheme}
                  isMixed={mixedKeys?.has("stroke")}
                />
                <NumberInput
                  label="Opacity"
                  labelOutside
                  value={Math.round((node.strokeOpacity ?? 1) * 100)}
                  onChange={(v) =>
                    effectiveOnUpdate({ strokeOpacity: Math.max(0, Math.min(100, v)) / 100 })
                  }
                  min={0}
                  max={100}
                  step={1}
                  isMixed={mixedKeys?.has("strokeOpacity")}
                />
              </PopoverContent>
            </Popover>
            <OverrideIndicator
              isOverridden={isOverridden(node.stroke, component?.stroke)}
              onReset={() => resetOverride("stroke")}
            />
          </div>
          )}

          {/* Mode + Align row */}
          <div className="flex items-center gap-1">
            {canUsePerSide && (
              <div className="flex-1">
                <SelectInput
                  label="Mode"
                  labelOutside
                  value={strokeMode}
                  // Per-side + gradient is out of scope (ambiguous geometry,
                  // see task spec p1-22) — omit "Per Side" while the stroke
                  // stack has a gradient paint so it can't be reached.
                  options={
                    hasGradientInStack
                      ? [{ value: "unified", label: "Unified" }]
                      : [
                          { value: "unified", label: "Unified" },
                          { value: "per-side", label: "Per Side" },
                        ]
                  }
                  onChange={handleModeChange}
                />
              </div>
            )}
            <div className="flex-1">
              <SelectInput
                label="Align"
                labelOutside
                value={mixedKeys?.has("strokeAlign") ? "" : (node.strokeAlign ?? (pathStroke?.align as 'center' | 'inside' | 'outside') ?? "center")}
                options={[
                  { value: "inside", label: "Inside" },
                  { value: "center", label: "Center" },
                  { value: "outside", label: "Outside" },
                ]}
                onChange={(v) => effectiveOnUpdate({ strokeAlign: v as 'center' | 'inside' | 'outside' })}
                isMixed={mixedKeys?.has("strokeAlign")}
              />
            </div>
          </div>

          {/* Unified weight input */}
          {strokeMode === "unified" && (
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <NumberInput
                  label="Weight"
                  labelOutside={true}
                  value={node.strokeWidth ?? pathStroke?.thickness ?? component?.strokeWidth ?? 1}
                  onChange={(v) => effectiveOnUpdate({ strokeWidth: v })}
                  min={0}
                  step={0.5}
                  isMixed={mixedKeys?.has("strokeWidth")}
                />
              </div>
              <OverrideIndicator
                isOverridden={isOverridden(
                  node.strokeWidth,
                  component?.strokeWidth
                )}
                onReset={() => resetOverride("strokeWidth")}
              />
            </div>
          )}

          {/* Arrowhead caps (line nodes only) */}
          {node.type === "line" && (
            <PropertyRow>
              <SelectInput
                label="Start cap"
                labelOutside
                value={(node as LineNode).startCap ?? "none"}
                options={CAP_OPTIONS}
                onChange={(v) => effectiveOnUpdate({ startCap: v as LineCapShape } as Partial<SceneNode>)}
              />
              <SelectInput
                label="End cap"
                labelOutside
                value={(node as LineNode).endCap ?? "none"}
                options={CAP_OPTIONS}
                onChange={(v) => effectiveOnUpdate({ endCap: v as LineCapShape } as Partial<SceneNode>)}
              />
            </PropertyRow>
          )}

          {/* Per-side inputs */}
          {strokeMode === "per-side" && (
            <>
              <PropertyRow>
                <NumberInput
                  label="T"
                  value={node.strokeWidthPerSide?.top ?? 0}
                  onChange={(v) => handlePerSideChange("top", v)}
                  min={0}
                  step={0.5}
                />
                <NumberInput
                  label="R"
                  value={node.strokeWidthPerSide?.right ?? 0}
                  onChange={(v) => handlePerSideChange("right", v)}
                  min={0}
                  step={0.5}
                />
              </PropertyRow>
              <PropertyRow>
                <NumberInput
                  label="B"
                  value={node.strokeWidthPerSide?.bottom ?? 0}
                  onChange={(v) => handlePerSideChange("bottom", v)}
                  min={0}
                  step={0.5}
                />
                <NumberInput
                  label="L"
                  value={node.strokeWidthPerSide?.left ?? 0}
                  onChange={(v) => handlePerSideChange("left", v)}
                  min={0}
                  step={0.5}
                />
              </PropertyRow>
            </>
          )}
        </>
      )}
    </PropertySection>
  );
}

/**
 * Paint-stack rows for a node whose `strokes` is set — add/remove/reorder,
 * per-paint opacity/blend mode, and the `GradientEditor` for gradient
 * layers. Deliberately a small local port of `FillSection`'s row markup
 * (which shares `PaintSwatch`/`BlendModeDropdown`/`paintSummary` via
 * export) rather than a byte-for-byte reuse: strokes only support
 * solid/linear/radial (no image/pattern/video/style binding) and keep their
 * own geometry section below this component.
 */
function StrokePaintStack({
  strokes,
  commit,
  colorVariables,
  activeTheme,
  canUseGradient,
}: {
  strokes: Paint[];
  commit: (next: Paint[]) => void;
  colorVariables: Variable[];
  activeTheme: ThemeName;
  canUseGradient: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDrop = (target: number) => {
    if (dragIndex !== null && dragIndex !== target) {
      commit(moveItem(strokes, dragIndex, target - dragIndex));
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  const canReorder = strokes.length > 1;
  const typeOptions = canUseGradient
    ? STROKE_TYPE_OPTIONS
    : STROKE_TYPE_OPTIONS.filter((o) => o.value === "solid");

  return (
    <div className="flex flex-col gap-1">
      {strokes
        .map((paint, arrayIndex) => ({ paint, arrayIndex }))
        .reverse()
        .map(({ paint, arrayIndex }) => {
          const kind = getFillKind(paint);
          const isVisible = paint.visible !== false;
          const canMoveUp = arrayIndex < strokes.length - 1;
          const canMoveDown = arrayIndex > 0;
          const isDropTarget = dropIndex === arrayIndex && dragIndex !== null && dragIndex !== arrayIndex;

          return (
            <div
              key={paint.id}
              className={clsx(
                "group/stroke-row relative flex items-center gap-1 rounded",
                isDropTarget && "ring-1 ring-border-hover",
                dragIndex === arrayIndex && "opacity-50",
              )}
              onDragOver={(e) => {
                if (dragIndex !== null) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropIndex(arrayIndex);
                }
              }}
              onDrop={() => handleDrop(arrayIndex)}
            >
              <div
                draggable={canReorder}
                onDragStart={(e) => {
                  if (!canReorder) return;
                  e.dataTransfer.effectAllowed = "move";
                  setDragIndex(arrayIndex);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                className={clsx(
                  "absolute left-[-16px] top-1/2 flex h-6 w-4 -translate-y-1/2 items-center justify-center text-text-primary opacity-0 transition-opacity",
                  canReorder
                    ? "cursor-grab group-hover/stroke-row:opacity-100 active:cursor-grabbing"
                    : "pointer-events-none",
                )}
                title={canReorder ? "Drag to reorder" : undefined}
              >
                <DotsSixVertical size={16} />
              </div>

              <Popover>
                <PopoverTrigger className={FILL_ROW_TRIGGER_CLASS} title="Edit stroke">
                  <PaintSwatch paint={paint} />
                  <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                    {paintSummary(paint)}
                  </span>
                </PopoverTrigger>
                <PopoverContent
                  draggable
                  dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Stroke</span>}
                >
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <SelectInput
                        value={kind}
                        options={typeOptions}
                        onChange={(v) => commit(convertFillKind(strokes, arrayIndex, v as FillKind))}
                      />
                    </div>
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveUp}
                      onClick={() => commit(moveItem(strokes, arrayIndex, 1))}
                      tooltip="Move up"
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveDown}
                      onClick={() => commit(moveItem(strokes, arrayIndex, -1))}
                      tooltip="Move down"
                    >
                      <ArrowDown />
                    </IconButton>
                    <BlendModeDropdown
                      value={paint.blendMode ?? "normal"}
                      onChange={(nextBlendMode) =>
                        commit(updateFillAt(strokes, arrayIndex, { ...paint, blendMode: nextBlendMode }))
                      }
                    />
                  </div>

                  {paint.type === "solid" && (
                    <ColorInput
                      value={paint.color}
                      onChange={(v) => commit(updateFillAt(strokes, arrayIndex, { ...paint, color: v }))}
                      variableId={paint.colorBinding?.variableId}
                      onVariableChange={(variableId) =>
                        commit(
                          updateFillAt(strokes, arrayIndex, {
                            ...paint,
                            colorBinding: variableId ? { variableId } : undefined,
                          }),
                        )
                      }
                      availableVariables={colorVariables}
                      activeTheme={activeTheme}
                    />
                  )}

                  {paint.type === "gradient" && (
                    <GradientEditor
                      gradient={paint.gradient}
                      onChange={(g) => commit(updateFillAt(strokes, arrayIndex, { ...paint, gradient: g }))}
                    />
                  )}

                  <NumberInput
                    label="Opacity"
                    labelOutside
                    value={Math.round((paint.opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    onChange={(v) =>
                      commit(
                        updateFillAt(strokes, arrayIndex, {
                          ...paint,
                          opacity: Math.min(100, Math.max(0, v)) / 100,
                        }),
                      )
                    }
                  />
                </PopoverContent>
              </Popover>

              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => commit(toggleFillVisibleAt(strokes, arrayIndex))}
                tooltip={isVisible ? "Hide stroke" : "Show stroke"}
              >
                {isVisible ? <Eye /> : <EyeSlash />}
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => commit(removeFillAt(strokes, arrayIndex))}
                tooltip="Remove stroke"
              >
                <MinusIcon />
              </IconButton>
            </div>
          );
        })}
      <IconButton
        variant="ghost"
        size="icon-sm"
        className="self-start"
        onClick={() => commit([...strokes, { id: generateId(), type: "solid", color: "#cccccc" }])}
        tooltip="Add stroke paint"
      >
        <PlusIcon />
      </IconButton>
    </div>
  );
}
