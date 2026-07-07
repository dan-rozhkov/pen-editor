import { useState } from "react";
import clsx from "clsx";
import type {
  GradientFill,
  ImageFill,
  Paint,
  PaintBlendMode,
  SceneNode,
} from "@/types/scene";
import { PAINT_BLEND_MODES } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeSlash,
  MinusIcon,
  PlusIcon,
  DotsSixVertical,
} from "@phosphor-icons/react";
import { GradientEditor } from "@/components/properties/GradientEditor";
import { ImageFillEditor } from "@/components/properties/ImageFillSection";
import { PatternFillEditor } from "@/components/properties/PatternFillSection";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";
import { getFills, clearLegacyFillProps } from "@/utils/fillUtils";
import { buildCSSGradient } from "@/utils/gradientUtils";
import {
  addSolidFill,
  convertFillKind,
  getFillKind,
  moveItem,
  removeFillAt,
  toggleFillVisibleAt,
  updateFillAt,
  type FillKind,
} from "@/components/properties/fillSectionUtils";

interface FillSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  component: SceneNode | null;
  colorVariables: Variable[];
  activeTheme: ThemeName;
  isOverridden: <T>(instanceVal: T | undefined, componentVal: T | undefined) => boolean;
  resetOverride: (property: keyof SceneNode) => void;
  mixedKeys?: Set<string>;
}

// Derived from the canonical blend-mode list ("color-dodge" → "Color Dodge").
const BLEND_MODE_OPTIONS: { value: PaintBlendMode; label: string }[] =
  PAINT_BLEND_MODES.map((mode) => ({
    value: mode,
    label: mode
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" "),
  }));

/** Small color/gradient/image preview swatch for a paint row. */
function PaintSwatch({ paint }: { paint: Paint }) {
  let style: React.CSSProperties;
  if (paint.type === "solid") {
    style = { backgroundColor: paint.color };
  } else if (paint.type === "gradient") {
    if (paint.gradient.type === "radial") {
      const stops = [...paint.gradient.stops]
        .sort((a, b) => a.position - b.position)
        .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
        .join(", ");
      style = { background: `radial-gradient(circle, ${stops})` };
    } else {
      style = { background: buildCSSGradient(paint.gradient.stops) };
    }
  } else if (paint.type === "pattern" && paint.pattern.url) {
    // Approximate the tile's actual scale: clamp so the swatch preview stays
    // legible at both extremes (a huge tile would otherwise render as one
    // solid color; a tiny one as unrecognizable noise).
    const scalePercent = Math.round(Math.min(1, Math.max(0.1, paint.pattern.scale ?? 1)) * 50);
    style = {
      backgroundImage: `url(${paint.pattern.url})`,
      backgroundSize: `${scalePercent}%`,
      backgroundRepeat: "repeat",
    };
  } else if (paint.type === "image" && paint.image.url) {
    style = {
      backgroundImage: `url(${paint.image.url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  } else {
    style = {
      background: "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px",
    };
  }
  return (
    <div
      className="h-4 w-4 shrink-0 rounded border border-border-default"
      style={style}
    />
  );
}

const FILL_TYPE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
];

const FILL_ROW_TRIGGER_CLASS =
  "flex min-w-0 flex-1 items-center gap-2 rounded bg-secondary px-1.5 py-1 text-left text-secondary-foreground hover:bg-secondary data-popup-open:bg-secondary";

/** One-line summary shown on the collapsed row (popover trigger). */
function paintSummary(paint: Paint): string {
  if (paint.type === "solid") return paint.color.toUpperCase();
  if (paint.type === "image") return "Image";
  if (paint.type === "pattern") return "Pattern";
  return paint.gradient.type === "radial" ? "Radial" : "Linear";
}

export function FillSection({
  node,
  onUpdate,
  component,
  colorVariables,
  activeTheme,
  isOverridden,
  resetOverride,
  mixedKeys,
}: FillSectionProps) {
  const fills = getFills(node);
  const isMixed = mixedKeys?.has("fills") || mixedKeys?.has("fill");

  const supportsImage =
    node.type === "rect" || node.type === "ellipse" || node.type === "frame";

  /**
   * Persist a new fill stack. Always clears legacy single-fill props so the two
   * representations never diverge (see fillUtils contract).
   */
  const commit = (next: Paint[]) => {
    onUpdate({ fills: next, ...clearLegacyFillProps() } as Partial<SceneNode>);
  };

  const handleAddFill = () => {
    commit(addSolidFill(fills));
  };

  // --- Drag-to-reorder state (array-index space) ---
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDrop = (target: number) => {
    if (dragIndex !== null && dragIndex !== target) {
      commit(moveItem(fills, dragIndex, target - dragIndex));
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  const canReorder = fills.length > 1;

  return (
    <PropertySection
      title="Fill"
      action={
        <Button variant="ghost" size="icon-sm" onClick={handleAddFill} title="Add fill">
          <PlusIcon />
        </Button>
      }
    >
      {isMixed ? (
        <span className="text-xs italic text-text-muted">Mixed</span>
      ) : fills.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          {/* Render top-to-bottom: last array element is the first (top) row. */}
          {fills
            .map((paint, arrayIndex) => ({ paint, arrayIndex }))
            .reverse()
            .map(({ paint, arrayIndex }, rowIndex) => {
              const kind = getFillKind(paint);
              const isVisible = paint.visible !== false;
              // arrayIndex toward end = top of stack. Up arrow moves toward top.
              const canMoveUp = arrayIndex < fills.length - 1;
              const canMoveDown = arrayIndex > 0;
              const isDropTarget =
                dropIndex === arrayIndex && dragIndex !== null && dragIndex !== arrayIndex;

              const typeOptions = supportsImage
                ? [
                    ...FILL_TYPE_OPTIONS,
                    { value: "image", label: "Image" },
                    { value: "pattern", label: "Pattern" },
                  ]
                : FILL_TYPE_OPTIONS;

              return (
                <div
                  key={paint.id}
                  className={clsx(
                    "group/fill-row relative flex items-center gap-1 rounded",
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
                  {/* Drag handle — reorder the stack by dragging */}
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
                        ? "cursor-grab group-hover/fill-row:opacity-100 active:cursor-grabbing"
                        : "pointer-events-none",
                    )}
                    title={canReorder ? "Drag to reorder" : undefined}
                  >
                    <DotsSixVertical size={16} />
                  </div>

                  {/* Compact trigger: swatch + summary opens the detail popover */}
                  <Popover>
                    <PopoverTrigger
                      className={FILL_ROW_TRIGGER_CLASS}
                      title="Edit fill"
                    >
                      <PaintSwatch paint={paint} />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {paintSummary(paint)}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent>
                      {/* Type + reorder */}
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <SelectInput
                            value={kind}
                            options={typeOptions}
                            onChange={(v) =>
                              commit(convertFillKind(fills, arrayIndex, v as FillKind))
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canMoveUp}
                          onClick={() => commit(moveItem(fills, arrayIndex, 1))}
                          title="Move up"
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canMoveDown}
                          onClick={() => commit(moveItem(fills, arrayIndex, -1))}
                          title="Move down"
                        >
                          <ArrowDown />
                        </Button>
                      </div>

                      {/* Solid color + variable binding */}
                      {paint.type === "solid" && (
                        <ColorInput
                          value={paint.color}
                          onChange={(v) =>
                            commit(updateFillAt(fills, arrayIndex, { ...paint, color: v }))
                          }
                          variableId={paint.colorBinding?.variableId}
                          onVariableChange={(variableId) =>
                            commit(
                              updateFillAt(fills, arrayIndex, {
                                ...paint,
                                colorBinding: variableId ? { variableId } : undefined,
                              }),
                            )
                          }
                          availableVariables={colorVariables}
                          activeTheme={activeTheme}
                        />
                      )}

                      {/* Gradient editor */}
                      {paint.type === "gradient" && (
                        <GradientEditor
                          gradient={paint.gradient}
                          onChange={(g: GradientFill) =>
                            commit(updateFillAt(fills, arrayIndex, { ...paint, gradient: g }))
                          }
                        />
                      )}

                      {/* Image editor */}
                      {paint.type === "image" && (
                        <ImageFillEditor
                          imageFill={paint.image}
                          onUpdate={(updates) => {
                            const img = (updates as { imageFill?: ImageFill }).imageFill;
                            if (!img) return;
                            commit(
                              updateFillAt(fills, arrayIndex, { ...paint, image: img }),
                            );
                          }}
                        />
                      )}

                      {/* Pattern editor */}
                      {paint.type === "pattern" && (
                        <PatternFillEditor
                          pattern={paint.pattern}
                          onChange={(p) =>
                            commit(
                              updateFillAt(fills, arrayIndex, { ...paint, pattern: p }),
                            )
                          }
                        />
                      )}

                      {/* Layer opacity (percent in UI, 0-1 in the model) */}
                      <NumberInput
                        label="Opacity"
                        labelOutside
                        value={Math.round((paint.opacity ?? 1) * 100)}
                        min={0}
                        max={100}
                        onChange={(v) =>
                          commit(
                            updateFillAt(fills, arrayIndex, {
                              ...paint,
                              opacity: Math.min(100, Math.max(0, v)) / 100,
                            }),
                          )
                        }
                      />

                      {/* Blend mode */}
                      <SelectInput
                        label="Blend"
                        labelOutside
                        value={paint.blendMode ?? "normal"}
                        options={BLEND_MODE_OPTIONS}
                        onChange={(v) =>
                          commit(
                            updateFillAt(fills, arrayIndex, {
                              ...paint,
                              blendMode: v as PaintBlendMode,
                            }),
                          )
                        }
                      />
                    </PopoverContent>
                  </Popover>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => commit(toggleFillVisibleAt(fills, arrayIndex))}
                    title={isVisible ? "Hide fill" : "Show fill"}
                  >
                    {isVisible ? <Eye /> : <EyeSlash />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => commit(removeFillAt(fills, arrayIndex))}
                    title="Remove fill"
                  >
                    <MinusIcon />
                  </Button>

                  {rowIndex === 0 && (
                    <OverrideIndicator
                      isOverridden={isOverridden(node.fill, component?.fill)}
                      onReset={() => resetOverride("fill")}
                    />
                  )}
                </div>
              );
            })}
        </div>
      )}
    </PropertySection>
  );
}
