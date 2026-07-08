import { useMemo } from "react";
import type { Effect, SceneNode, ShadowEffect } from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, Eye, EyeSlash, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { parseHexAlpha } from "@/utils/shadowUtils";
import {
  createBlurEffect,
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

/** Human label for an effect row, derived from the effect (not hardcoded). */
function effectLabel(effect: Effect): string {
  if (effect.type === "blur") return "Layer Blur";
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

  return (
    <PropertySection
      title="Effects"
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" title="Add effect" />}
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
                <div key={effect.id} className="flex items-center gap-1">
                  {/* Compact trigger: swatch + label opens the detail popover */}
                  <Popover>
                    <PopoverTrigger
                      className="flex min-w-0 flex-1 items-center gap-2 rounded bg-secondary px-1.5 py-1 text-left"
                      title="Edit effect"
                    >
                      <div
                        className="h-4 w-4 shrink-0 rounded border border-border-default"
                        style={effect.type === "shadow" ? { backgroundColor: effect.color } : undefined}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {effectLabel(effect)}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent>
                      {/* Title + reorder */}
                      <div className="flex items-center gap-1">
                        <span className="flex-1 text-[11px] font-semibold text-text-primary">
                          {effectLabel(effect)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canMoveUp}
                          onClick={() => commit(moveItem(effects, arrayIndex, 1))}
                          title="Move up"
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={!canMoveDown}
                          onClick={() => commit(moveItem(effects, arrayIndex, -1))}
                          title="Move down"
                        >
                          <ArrowDown />
                        </Button>
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

                      {effect.type === "blur" && (
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
                    </PopoverContent>
                  </Popover>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => commit(toggleEffectVisibleAt(effects, arrayIndex))}
                    title={isVisible ? "Hide effect" : "Show effect"}
                  >
                    {isVisible ? <Eye /> : <EyeSlash />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => commit(removeEffectAt(effects, arrayIndex))}
                    title="Remove effect"
                  >
                    <MinusIcon />
                  </Button>
                </div>
              );
            })}
        </div>
      ) : null}
    </PropertySection>
  );
}
