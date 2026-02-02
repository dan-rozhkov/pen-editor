import type { SceneNode } from "@/types/scene";
import {
  ColorInput,
  NumberInput,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { getDefaultShadow } from "@/utils/shadowUtils";

interface EffectsSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function EffectsSection({ node, onUpdate }: EffectsSectionProps) {
  return (
    <PropertySection
      title="Effects"
      action={
        !node.effect ? (
          <Button variant="ghost" size="icon-sm" onClick={() => onUpdate({ effect: getDefaultShadow() })}>
            <PlusIcon />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={() => onUpdate({ effect: undefined })}>
            <MinusIcon />
          </Button>
        )
      }
    >
      {node.effect && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Drop Shadow</span>
          <ColorInput
            value={node.effect.color}
            onChange={(v) =>
              onUpdate({
                effect: { ...node.effect!, color: v || "#00000040" },
              })
            }
          />
          <div className="grid grid-cols-2 gap-1">
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
          </div>
          <div className="grid grid-cols-2 gap-1">
            <NumberInput
              label="Blur"
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
              value={node.effect.spread}
              onChange={(v) =>
                onUpdate({
                  effect: { ...node.effect!, spread: v },
                })
              }
              step={1}
            />
          </div>
        </div>
      )}
    </PropertySection>
  );
}
