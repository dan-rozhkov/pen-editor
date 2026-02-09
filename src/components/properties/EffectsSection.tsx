import type { SceneNode } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { getDefaultShadow, parseHexAlpha } from "@/utils/shadowUtils";

interface EffectsSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
}

export function EffectsSection({ node, onUpdate, mixedKeys }: EffectsSectionProps) {
  return (
    <PropertySection
      title="Effects"
      action={
        !node.effect ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onUpdate({ effect: getDefaultShadow() })}
          >
            <PlusIcon />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onUpdate({ effect: undefined })}
          >
            <MinusIcon />
          </Button>
        )
      }
    >
      {node.effect && (
        <div className="flex flex-col gap-2">
          <Label className="text-[10px] font-normal">Drop Shadow</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ColorInput
                value={node.effect.color}
                isMixed={mixedKeys?.has("effect")}
                onChange={(v) =>
                  onUpdate({
                    effect: { ...node.effect!, color: v || "#00000040" },
                  })
                }
              />
            </div>
            <div className="w-20">
              <NumberInput
                label="%"
                value={Math.round(
                  parseHexAlpha(node.effect.color).opacity * 100
                )}
                onChange={(v) => {
                  const opacity = Math.max(0, Math.min(100, v)) / 100;
                  const alpha = Math.round(opacity * 255)
                    .toString(16)
                    .padStart(2, "0");
                  const baseColor = node.effect!.color.slice(0, 7);
                  onUpdate({
                    effect: { ...node.effect!, color: baseColor + alpha },
                  });
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
              value={node.effect.offset.x}
              onChange={(v) =>
                onUpdate({
                  effect: {
                    ...node.effect!,
                    offset: { ...node.effect!.offset, x: v },
                  },
                })
              }
              step={1}
            />
            <NumberInput
              label="Y"
              value={node.effect.offset.y}
              onChange={(v) =>
                onUpdate({
                  effect: {
                    ...node.effect!,
                    offset: { ...node.effect!.offset, y: v },
                  },
                })
              }
              step={1}
            />
          </PropertyRow>
          <PropertyRow>
            <NumberInput
              label="Blur"
              labelOutside={true}
              value={node.effect.blur}
              onChange={(v) =>
                onUpdate({
                  effect: { ...node.effect!, blur: Math.max(0, v) },
                })
              }
              min={0}
              step={1}
            />
            <NumberInput
              label="Spread"
              labelOutside={true}
              value={node.effect.spread}
              onChange={(v) =>
                onUpdate({
                  effect: { ...node.effect!, spread: v },
                })
              }
              step={1}
            />
          </PropertyRow>
        </div>
      )}
    </PropertySection>
  );
}
