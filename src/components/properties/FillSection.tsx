import { useState } from "react";
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
import {
  ArrowDown,
  ArrowUp,
  CaretDownIcon,
  CaretRightIcon,
  Eye,
  EyeSlash,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { GradientEditor } from "@/components/properties/GradientEditor";
import { ImageFillEditor } from "@/components/properties/ImageFillSection";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";
import { getFills, clearLegacyFillProps } from "@/utils/fillUtils";
import { buildCSSGradient } from "@/utils/gradientUtils";
import {
  addSolidFill,
  convertFillKind,
  getFillKind,
  moveFill,
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
  } else if (paint.image.url) {
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

  // Track which solid rows are expanded by paint id (gradient/image rows are
  // always expanded; solid rows expose the blend-mode select when expanded).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        <div className="flex flex-col gap-2">
          {/* Render top-to-bottom: last array element is the first (top) row. */}
          {fills
            .map((paint, arrayIndex) => ({ paint, arrayIndex }))
            .reverse()
            .map(({ paint, arrayIndex }, rowIndex) => {
              const kind = getFillKind(paint);
              // Only solid rows actually collapse anything (the blend select);
              // gradient/image rows always show their editor + blend select.
              const collapsible = kind === "solid";
              const isExpanded = !collapsible || expandedIds.has(paint.id);
              const isVisible = paint.visible !== false;
              // arrayIndex toward end = top of stack. Up arrow moves toward top.
              const canMoveUp = arrayIndex < fills.length - 1;
              const canMoveDown = arrayIndex > 0;

              const typeOptions = supportsImage
                ? [...FILL_TYPE_OPTIONS, { value: "image", label: "Image" }]
                : FILL_TYPE_OPTIONS;

              return (
                <div
                  key={paint.id}
                  className="flex flex-col gap-2 rounded border border-border-default p-2"
                >
                  {/* Row header: swatch + type + reorder + visibility + delete */}
                  <div className="flex items-center gap-1">
                    {collapsible ? (
                      <button
                        type="button"
                        className="shrink-0 text-text-muted hover:text-text-primary"
                        onClick={() => toggleExpanded(paint.id)}
                        title={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? (
                          <CaretDownIcon size={12} />
                        ) : (
                          <CaretRightIcon size={12} />
                        )}
                      </button>
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <PaintSwatch paint={paint} />
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
                      onClick={() => commit(moveFill(fills, arrayIndex, 1))}
                      title="Move up"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveDown}
                      onClick={() => commit(moveFill(fills, arrayIndex, -1))}
                      title="Move down"
                    >
                      <ArrowDown />
                    </Button>
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
                      <TrashIcon />
                    </Button>
                  </div>

                  {/* Solid: color + opacity (always shown) */}
                  {paint.type === "solid" && (
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <ColorInput
                          value={paint.color}
                          onChange={(v) =>
                            commit(
                              updateFillAt(fills, arrayIndex, {
                                ...paint,
                                color: v,
                              }),
                            )
                          }
                          variableId={paint.colorBinding?.variableId}
                          onVariableChange={(variableId) =>
                            commit(
                              updateFillAt(fills, arrayIndex, {
                                ...paint,
                                colorBinding: variableId
                                  ? { variableId }
                                  : undefined,
                              }),
                            )
                          }
                          availableVariables={colorVariables}
                          activeTheme={activeTheme}
                        />
                      </div>
                      <div className="w-20">
                        <NumberInput
                          label="%"
                          value={Math.round((paint.opacity ?? 1) * 100)}
                          onChange={(v) =>
                            commit(
                              updateFillAt(fills, arrayIndex, {
                                ...paint,
                                opacity: Math.max(0, Math.min(100, v)) / 100,
                              }),
                            )
                          }
                          min={0}
                          max={100}
                          step={1}
                        />
                      </div>
                      {rowIndex === 0 && (
                        <OverrideIndicator
                          isOverridden={isOverridden(node.fill, component?.fill)}
                          onReset={() => resetOverride("fill")}
                        />
                      )}
                    </div>
                  )}

                  {/* Gradient editor */}
                  {paint.type === "gradient" && isExpanded && (
                    <GradientEditor
                      gradient={paint.gradient}
                      onChange={(g: GradientFill) =>
                        commit(
                          updateFillAt(fills, arrayIndex, {
                            ...paint,
                            gradient: g,
                          }),
                        )
                      }
                    />
                  )}

                  {/* Image editor */}
                  {paint.type === "image" && isExpanded && (
                    <ImageFillEditor
                      imageFill={paint.image}
                      onUpdate={(updates) => {
                        const img = (updates as { imageFill?: ImageFill }).imageFill;
                        if (!img) return;
                        commit(
                          updateFillAt(fills, arrayIndex, {
                            ...paint,
                            image: img,
                          }),
                        );
                      }}
                    />
                  )}

                  {/* Blend mode (expanded) */}
                  {isExpanded && (
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
                  )}
                </div>
              );
            })}
        </div>
      )}
    </PropertySection>
  );
}
