import type {
  GradientFill,
  ImageFill,
  Paint,
  SceneNode,
} from "@/types/scene";
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
  type PaintSectionProps,
} from "@/components/properties/fillSectionUtils";
import { BlendModeDropdown, PaintSwatch, StackRowShell, useDragReorder } from "@/components/properties/stackRow";

interface FillSectionProps extends PaintSectionProps {
  /**
   * Restrict which fill kinds the type selector offers. `video` renders as a
   * real `<video>`/`<iframe>` element alongside the node's background
   * (`generateVideoFillHtml`, designToHtml/styleGeneration.ts) — it isn't a
   * CSS background at all, so it can't be produced by writing inline CSS to
   * an existing HTML element (no CSS property can insert a new element).
   * Omitted (default) offers every kind, unchanged from today. Used by the
   * embed-element properties panel.
   */
  allowedFillKinds?: FillKind[];
  /**
   * The node passed in isn't backed by a real entry in `nodesById` (e.g. a
   * synthetic node built from an embed's computed style). The fill-style
   * apply/detach picker below writes to `useStyleStore`
   * (`detachFillStyleFromPaint`) by `node.id` directly, bypassing `onUpdate`
   * — for a detached node that's either a silent no-op or a write to
   * whatever unrelated real node happens to share that id. Hides the picker
   * entirely; the rest of the row (color/gradient/image/pattern/video
   * editors, opacity) is unaffected since it always goes through `onUpdate`.
   * Used by the embed-element properties panel.
   */
  detachedNode?: boolean;
}

const FILL_TYPE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
];

export function FillSection({
  node,
  onUpdate,
  colorVariables,
  activeTheme,
  mixedKeys,
  allowedFillKinds,
  detachedNode = false,
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
            .map(({ paint, arrayIndex }) => {
              const kind = getFillKind(paint);
              const isVisible = paint.visible !== false;
              // arrayIndex toward end = top of stack. Up arrow moves toward top.
              const canMoveUp = arrayIndex < fills.length - 1;
              const canMoveDown = arrayIndex > 0;

              const allTypeOptions = supportsImage
                ? [
                    ...FILL_TYPE_OPTIONS,
                    { value: "image", label: "Image" },
                    { value: "pattern", label: "Pattern" },
                    { value: "video", label: "Video" },
                  ]
                : FILL_TYPE_OPTIONS;
              const typeOptions = allowedFillKinds
                ? allTypeOptions.filter((o) => allowedFillKinds.includes(o.value as FillKind))
                : allTypeOptions;

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

                  {/* Named fill-style binding (apply / detach) — hidden for a
                      detached node, see the `detachedNode` doc comment above. */}
                  {!detachedNode && (
                    <StylePicker
                      kindLabel="fill style"
                      styles={fillStyles}
                      boundId={paint.styleId}
                      onPick={(styleId) =>
                        commit(updateFillAt(fills, arrayIndex, { ...paint, styleId }))
                      }
                      onDetach={() => detachFillStyleFromPaint(node.id, paint.id)}
                    />
                  )}

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
