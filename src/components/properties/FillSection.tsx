import type {
  GradientFill,
  ImageFill,
  Paint,
  SceneNode,
} from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { IconButton } from "@/components/ui/IconButton";
import { ArrowDown, ArrowUp, PlusIcon } from "@phosphor-icons/react";
import { GradientEditor } from "@/components/properties/GradientEditor";
import { ImageFillEditor } from "@/components/properties/ImageFillSection";
import { PatternFillEditor } from "@/components/properties/PatternFillSection";
import { VideoFillEditor } from "@/components/properties/VideoFillSection";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";
import { StylePicker } from "@/components/properties/StylePicker";
import { useStyleStore } from "@/store/styleStore";
import { getFills, clearLegacyFillProps } from "@/utils/fillUtils";
import {
  addSolidFill,
  convertFillKind,
  getFillKind,
  moveItem,
  paintSummary,
  removeFillAt,
  toggleFillVisibleAt,
  updateFillAt,
  type FillKind,
} from "@/components/properties/fillSectionUtils";
import { BlendModeDropdown, PaintSwatch, StackRowShell, useDragReorder } from "@/components/properties/stackRow";

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
  const fillStyles = useStyleStore((s) => s.fillStyles);
  const detachFillStyleFromPaint = useStyleStore((s) => s.detachFillStyleFromPaint);

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

  const drag = useDragReorder(fills.length, (from, delta) => commit(moveItem(fills, from, delta)));
  const canReorder = drag.canReorder;

  return (
    <PropertySection
      title="Fill"
      action={
        <IconButton variant="ghost" size="icon-sm" onClick={handleAddFill} tooltip="Add fill">
          <PlusIcon />
        </IconButton>
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

              const typeOptions = supportsImage
                ? [
                    ...FILL_TYPE_OPTIONS,
                    { value: "image", label: "Image" },
                    { value: "pattern", label: "Pattern" },
                    { value: "video", label: "Video" },
                  ]
                : FILL_TYPE_OPTIONS;

              return (
                <StackRowShell
                  key={paint.id}
                  arrayIndex={arrayIndex}
                  canReorder={canReorder}
                  drag={drag}
                  visible={isVisible}
                  onToggleVisible={() => commit(toggleFillVisibleAt(fills, arrayIndex))}
                  onRemove={() => commit(removeFillAt(fills, arrayIndex))}
                  itemLabel="fill"
                  triggerTitle="Edit fill"
                  triggerContent={
                    <>
                      <PaintSwatch paint={paint} />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {paintSummary(paint)}
                      </span>
                    </>
                  }
                  popoverTitle={<span className="text-[11px] font-semibold text-text-primary">Fill</span>}
                  trailing={
                    rowIndex === 0 && (
                      <OverrideIndicator
                        isOverridden={isOverridden(node.fill, component?.fill)}
                        onReset={() => resetOverride("fill")}
                      />
                    )
                  }
                >
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
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveUp}
                      onClick={() => commit(moveItem(fills, arrayIndex, 1))}
                      tooltip="Move up"
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveDown}
                      onClick={() => commit(moveItem(fills, arrayIndex, -1))}
                      tooltip="Move down"
                    >
                      <ArrowDown />
                    </IconButton>
                    <BlendModeDropdown
                      value={paint.blendMode ?? "normal"}
                      onChange={(nextBlendMode) =>
                        commit(
                          updateFillAt(fills, arrayIndex, {
                            ...paint,
                            blendMode: nextBlendMode,
                          }),
                        )
                      }
                    />
                  </div>

                  {/* Named fill-style binding (apply / detach) */}
                  <StylePicker
                    kindLabel="fill style"
                    styles={fillStyles}
                    boundId={paint.styleId}
                    onPick={(styleId) =>
                      commit(updateFillAt(fills, arrayIndex, { ...paint, styleId }))
                    }
                    onDetach={() => detachFillStyleFromPaint(node.id, paint.id)}
                  />

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

                  {/* Video editor */}
                  {paint.type === "video" && (
                    <VideoFillEditor
                      video={paint.video}
                      onChange={(v) =>
                        commit(
                          updateFillAt(fills, arrayIndex, { ...paint, video: v }),
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
                </StackRowShell>
              );
            })}
        </div>
      )}
    </PropertySection>
  );
}
