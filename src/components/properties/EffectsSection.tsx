import type { Effect, SceneNode, ShadowEffect } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Eye, EyeSlash, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { parseHexAlpha } from "@/utils/shadowUtils";
import {
  createShadowEffect,
  getEffects,
  clearLegacyEffectProps,
} from "@/utils/fillUtils";
import {
  addEffect,
  removeEffectAt,
  toggleEffectVisibleAt,
  updateEffectAt,
} from "@/components/properties/fillSectionUtils";

interface EffectsSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
}

export function EffectsSection({ node, onUpdate, mixedKeys }: EffectsSectionProps) {
  const effects = getEffects(node);
  const isMixed = mixedKeys?.has("effects") || mixedKeys?.has("effect");

  const commit = (next: Effect[]) => {
    onUpdate({ effects: next, ...clearLegacyEffectProps() } as Partial<SceneNode>);
  };

  const handleAdd = () => {
    commit(addEffect(effects, createShadowEffect()));
  };

  const updateShadow = (index: number, shadow: ShadowEffect) => {
    commit(updateEffectAt(effects, index, shadow));
  };

  return (
    <PropertySection
      title="Effects"
      action={
        <Button variant="ghost" size="icon-sm" onClick={handleAdd} title="Add effect">
          <PlusIcon />
        </Button>
      }
    >
      {isMixed ? (
        <span className="text-xs italic text-text-muted">Mixed</span>
      ) : effects.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          {effects
            .map((effect, arrayIndex) => ({ effect, arrayIndex }))
            .reverse()
            .map(({ effect, arrayIndex }) => {
              const isVisible = effect.visible !== false;
              return (
                <div
                  key={effect.id ?? arrayIndex}
                  className="flex flex-col gap-2 rounded border border-border-default p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[10px] font-normal text-text-muted">
                      Drop Shadow
                    </span>
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
                      <TrashIcon />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ColorInput
                        value={effect.color}
                        onChange={(v) =>
                          updateShadow(arrayIndex, { ...effect, color: v || "#00000040" })
                        }
                      />
                    </div>
                    <div className="w-20">
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
                </div>
              );
            })}
        </div>
      )}
    </PropertySection>
  );
}
