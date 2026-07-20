import { useMemo } from "react";
import type { Effect, NoiseEffect, SceneNode, ShadowEffect } from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { IconButton } from "@/components/ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, PlusIcon } from "@phosphor-icons/react";
import { parseHexAlpha } from "@/utils/shadowUtils";
import {
  createBackgroundBlurEffect,
  createBlurEffect,
  createNoiseEffect,
  createShadowEffect,
  getEffects,
  clearLegacyEffectProps,
} from "@/utils/fillUtils";
import {
  addEffect,
  moveItem,
  removeEffectAt,
  toggleEffectVisibleAt,
  updateEffectAt,
} from "@/components/properties/fillSectionUtils";
import { StylePicker } from "@/components/properties/StylePicker";
import { useStyleStore } from "@/store/styleStore";
import { BlendModeDropdown, StackRowShell, useDragReorder } from "@/components/properties/stackRow";
import { MAX_NOISE_EFFECTS } from "@/pixi/renderers/noiseEffectHelpers";

const NOISE_TYPE_OPTIONS: { value: NoiseEffect["noiseType"]; label: string }[] = [
  { value: "mono", label: "Mono" },
  { value: "duo", label: "Duo" },
  { value: "multi", label: "Multi" },
];

/** Human label for an effect row, derived from the effect (not hardcoded). */
function effectLabel(effect: Effect): string {
  if (effect.type === "blur") return "Layer Blur";
  if (effect.type === "background-blur") return "Background Blur";
  if (effect.type === "noise") return "Noise";
  return effect.shadowType === "inner" ? "Inner Shadow" : "Drop Shadow";
}

interface EffectsSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
}

export function EffectsSection({ node, onUpdate, mixedKeys }: EffectsSectionProps) {
  // Effects from .pen import / AI tools may lack a stable `id`. Backfill one so
  // React keys (and reorder) track the right shadow; memoized on the source
  // array so ids stay stable across renders. createShadowEffect already sets one.
  const rawEffects = getEffects(node);
  const effects = useMemo(
    () => rawEffects.map((e) => (e.id ? e : { ...e, id: generateId() })),
    [rawEffects],
  );
  const isMixed = mixedKeys?.has("effects") || mixedKeys?.has("effect");

  const effectStyles = useStyleStore((s) => s.effectStyles);
  const applyEffectStyleToNode = useStyleStore((s) => s.applyEffectStyleToNode);
  const detachEffectStyleFromNode = useStyleStore((s) => s.detachEffectStyleFromNode);
  const boundEffectStyleId = node.effectStyleId;
  const hasEffectControls = effectStyles.length > 0 || effects.length > 0;

  const commit = (next: Effect[]) => {
    onUpdate({ effects: next, ...clearLegacyEffectProps() } as Partial<SceneNode>);
  };

  const handleAdd = (effect: Effect) => {
    commit(addEffect(effects, effect));
  };

  const updateShadow = (index: number, shadow: ShadowEffect) => {
    commit(updateEffectAt(effects, index, shadow));
  };

  const updateNoise = (index: number, noise: NoiseEffect) => {
    commit(updateEffectAt(effects, index, noise));
  };

  const noiseCount = effects.filter((e) => e.type === "noise").length;

  // Drag-to-reorder is deliberately left off for effects (see plans/017) —
  // enabling it is a one-prop change (`canReorder`), a follow-up.
  const drag = useDragReorder(effects.length, (from, delta) => commit(moveItem(effects, from, delta)));

  return (
    <PropertySection
      title="Effects"
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton variant="ghost" size="icon-sm" tooltip="Add effect">
                <PlusIcon />
              </IconButton>
            }
          >
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleAdd(createShadowEffect())}>
              Drop shadow
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleAdd(createShadowEffect({ shadowType: "inner" }))}
            >
              Inner shadow
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAdd(createBlurEffect())}>
              Layer blur
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAdd(createBackgroundBlurEffect())}>
              Background blur
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleAdd(createNoiseEffect())}
              disabled={noiseCount >= MAX_NOISE_EFFECTS}
            >
              Noise
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {isMixed ? (
        <span className="text-xs italic text-text-muted">Mixed</span>
      ) : boundEffectStyleId ? (
        // Bound to a named effect style: the whole stack is style-driven, so the
        // per-effect editors are suppressed in favor of the binding control.
        <StylePicker
          kindLabel="effect style"
          styles={effectStyles}
          boundId={boundEffectStyleId}
          onPick={(styleId) => applyEffectStyleToNode(node.id, styleId)}
          onDetach={() => detachEffectStyleFromNode(node.id)}
        />
      ) : hasEffectControls ? (
        <div className="flex flex-col gap-1">
          {effectStyles.length > 0 && (
            <StylePicker
              kindLabel="effect style"
              styles={effectStyles}
              onPick={(styleId) => applyEffectStyleToNode(node.id, styleId)}
              onDetach={() => detachEffectStyleFromNode(node.id)}
            />
          )}
          {effects
            .map((effect, arrayIndex) => ({ effect, arrayIndex }))
            .reverse()
            .map(({ effect, arrayIndex }) => {
              const isVisible = effect.visible !== false;
              // arrayIndex toward end = top of stack. Up arrow moves toward top.
              const canMoveUp = arrayIndex < effects.length - 1;
              const canMoveDown = arrayIndex > 0;

              return (
                <StackRowShell
                  key={effect.id}
                  arrayIndex={arrayIndex}
                  canReorder={false}
                  drag={drag}
                  visible={isVisible}
                  onToggleVisible={() => commit(toggleEffectVisibleAt(effects, arrayIndex))}
                  onRemove={() => commit(removeEffectAt(effects, arrayIndex))}
                  itemLabel="effect"
                  triggerTitle="Edit effect"
                  // Effects aren't paints — a hand-rolled swatch instead of
                  // PaintSwatch — and the trigger class here has always been
                  // a hardcoded subset of FILL_ROW_TRIGGER_CLASS (no hover/
                  // open-state background), so it's kept as its own class
                  // rather than switched to the shared constant.
                  triggerClassName="flex min-w-0 flex-1 items-center gap-2 rounded bg-secondary px-1.5 py-1 text-left"
                  triggerContent={
                    <>
                      <div
                        className="h-4 w-4 shrink-0 rounded border border-border-default"
                        style={
                          effect.type === "shadow" ||
                          (effect.type === "noise" && effect.noiseType !== "multi")
                            ? { backgroundColor: effect.color }
                            : undefined
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {effectLabel(effect)}
                      </span>
                    </>
                  }
                  popoverTitle={
                    <span className="text-[11px] font-semibold text-text-primary">
                      {effectLabel(effect)}
                    </span>
                  }
                >
                  {/* Title + reorder */}
                  <div className="flex items-center gap-1">
                    <span className="flex-1" />
                    <IconButton
                      tooltip="Move up"
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveUp}
                      onClick={() => commit(moveItem(effects, arrayIndex, 1))}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      tooltip="Move down"
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canMoveDown}
                      onClick={() => commit(moveItem(effects, arrayIndex, -1))}
                    >
                      <ArrowDown />
                    </IconButton>
                    {effect.type === "noise" && (
                      <BlendModeDropdown
                        value={effect.blendMode}
                        onChange={(nextBlendMode) =>
                          updateNoise(arrayIndex, {
                            ...effect,
                            blendMode: nextBlendMode === "normal" ? undefined : nextBlendMode,
                          })
                        }
                      />
                    )}
                  </div>

                  {effect.type === "shadow" && (
                    <>
                      {/* Color + opacity */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <ColorInput
                            value={effect.color}
                            onChange={(v) =>
                              updateShadow(arrayIndex, { ...effect, color: v || "#00000040" })
                            }
                          />
                        </div>
                        <div className="w-16 shrink-0">
                          <NumberInput
                            label="%"
                            value={Math.round(parseHexAlpha(effect.color).opacity * 100)}
                            onChange={(v) => {
                              const opacity = Math.max(0, Math.min(100, v)) / 100;
                              const alpha = Math.round(opacity * 255)
                                .toString(16)
                                .padStart(2, "0");
                              const baseColor = effect.color.slice(0, 7);
                              updateShadow(arrayIndex, { ...effect, color: baseColor + alpha });
                            }}
                            min={0}
                            max={100}
                            step={1}
                          />
                        </div>
                      </div>

                      <PropertyRow>
                        <NumberInput
                          label="X"
                          value={effect.offset.x}
                          onChange={(v) =>
                            updateShadow(arrayIndex, {
                              ...effect,
                              offset: { ...effect.offset, x: v },
                            })
                          }
                          step={1}
                        />
                        <NumberInput
                          label="Y"
                          value={effect.offset.y}
                          onChange={(v) =>
                            updateShadow(arrayIndex, {
                              ...effect,
                              offset: { ...effect.offset, y: v },
                            })
                          }
                          step={1}
                        />
                      </PropertyRow>

                      <PropertyRow>
                        <NumberInput
                          label="Blur"
                          labelOutside
                          value={effect.blur}
                          onChange={(v) =>
                            updateShadow(arrayIndex, { ...effect, blur: Math.max(0, v) })
                          }
                          min={0}
                          step={1}
                        />
                        <NumberInput
                          label="Spread"
                          labelOutside
                          value={effect.spread}
                          onChange={(v) => updateShadow(arrayIndex, { ...effect, spread: v })}
                          step={1}
                        />
                      </PropertyRow>
                    </>
                  )}

                  {(effect.type === "blur" || effect.type === "background-blur") && (
                    <PropertyRow>
                      <NumberInput
                        label="Blur"
                        labelOutside
                        value={effect.radius}
                        onChange={(v) =>
                          commit(
                            updateEffectAt(effects, arrayIndex, {
                              ...effect,
                              radius: Math.max(0, Math.min(100, v)),
                            }),
                          )
                        }
                        min={0}
                        max={100}
                        step={1}
                      />
                    </PropertyRow>
                  )}

                  {effect.type === "noise" && (
                    <>
                      {/* Noise type: mono (single color) / duo (two colors) / multi (random). */}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              className="flex items-center justify-between rounded bg-secondary px-2 py-1 text-xs text-text-primary hover:bg-secondary/80"
                            />
                          }
                        >
                          {NOISE_TYPE_OPTIONS.find((o) => o.value === effect.noiseType)?.label ??
                            "Mono"}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {NOISE_TYPE_OPTIONS.map((option) => (
                            <DropdownMenuItem
                              key={option.value}
                              onClick={() =>
                                updateNoise(arrayIndex, {
                                  ...effect,
                                  noiseType: option.value,
                                  secondaryColor:
                                    option.value === "duo"
                                      ? (effect.secondaryColor ?? "#ffffffff")
                                      : effect.secondaryColor,
                                })
                              }
                            >
                              {option.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {(effect.noiseType === "mono" || effect.noiseType === "duo") && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ColorInput
                              value={effect.color}
                              onChange={(v) =>
                                updateNoise(arrayIndex, { ...effect, color: v || "#00000080" })
                              }
                            />
                          </div>
                          <div className="w-16 shrink-0">
                            <NumberInput
                              label="%"
                              value={Math.round(parseHexAlpha(effect.color).opacity * 100)}
                              onChange={(v) => {
                                const opacity = Math.max(0, Math.min(100, v)) / 100;
                                const alpha = Math.round(opacity * 255)
                                  .toString(16)
                                  .padStart(2, "0");
                                const baseColor = effect.color.slice(0, 7);
                                updateNoise(arrayIndex, { ...effect, color: baseColor + alpha });
                              }}
                              min={0}
                              max={100}
                              step={1}
                            />
                          </div>
                        </div>
                      )}

                      {effect.noiseType === "duo" && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <ColorInput
                              value={effect.secondaryColor ?? "#ffffffff"}
                              onChange={(v) =>
                                updateNoise(arrayIndex, {
                                  ...effect,
                                  secondaryColor: v || "#ffffffff",
                                })
                              }
                            />
                          </div>
                        </div>
                      )}

                      {effect.noiseType === "multi" && (
                        <div className="w-16 shrink-0 self-end">
                          <NumberInput
                            label="%"
                            value={Math.round((effect.opacity ?? 1) * 100)}
                            onChange={(v) =>
                              updateNoise(arrayIndex, {
                                ...effect,
                                opacity: Math.max(0, Math.min(100, v)) / 100,
                              })
                            }
                            min={0}
                            max={100}
                            step={1}
                          />
                        </div>
                      )}

                      <PropertyRow>
                        <NumberInput
                          label="Size X"
                          labelOutside
                          value={effect.noiseSize}
                          onChange={(v) =>
                            updateNoise(arrayIndex, { ...effect, noiseSize: Math.max(1, v) })
                          }
                          min={1}
                          step={1}
                        />
                        <NumberInput
                          label="Size Y"
                          labelOutside
                          value={effect.noiseSizeY ?? effect.noiseSize}
                          onChange={(v) => {
                            const size = Math.max(1, v);
                            updateNoise(arrayIndex, {
                              ...effect,
                              noiseSizeY: size === effect.noiseSize ? undefined : size,
                            });
                          }}
                          min={1}
                          step={1}
                        />
                      </PropertyRow>

                      <PropertyRow>
                        <NumberInput
                          label="Density"
                          labelOutside
                          value={Math.round(effect.density * 100)}
                          onChange={(v) =>
                            updateNoise(arrayIndex, {
                              ...effect,
                              density: Math.max(0, Math.min(100, v)) / 100,
                            })
                          }
                          min={0}
                          max={100}
                          step={1}
                        />
                      </PropertyRow>
                    </>
                  )}
                </StackRowShell>
              );
            })}
        </div>
      ) : null}
    </PropertySection>
  );
}
