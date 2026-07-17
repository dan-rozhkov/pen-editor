import { ArrowClockwise } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { SceneNode } from "@/types/scene";
import type { FlatParentContext, ParentContext } from "@/utils/nodeUtils";
import {
  FlipControls,
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface PositionSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
  parentContext?: ParentContext | FlatParentContext;
  alignment?: ReactNode;
}

export function PositionSection({ node, onUpdate, mixedKeys, parentContext, alignment }: PositionSectionProps) {
  const isInsideAutoLayout = parentContext?.isInsideAutoLayout ?? false;

  return (
    <PropertySection title="Position">
      {alignment}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] text-text-primary">Position</div>
        <PropertyRow>
          <NumberInput
            label="X"
            value={node.x}
            onChange={(v) => onUpdate({ x: v })}
            isMixed={mixedKeys?.has("x")}
          />
          <NumberInput
            label="Y"
            value={node.y}
            onChange={(v) => onUpdate({ y: v })}
            isMixed={mixedKeys?.has("y")}
          />
        </PropertyRow>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] text-text-primary">Rotation</div>
        <div className="flex gap-2">
          <div className="w-1/2">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <ArrowClockwise size={14} />
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                value={mixedKeys?.has("rotation") ? "" : Math.round((node.rotation ?? 0) * 100) / 100}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    onUpdate({ rotation: val });
                  }
                }}
                min={0}
                max={360}
                step={1}
                placeholder={mixedKeys?.has("rotation") ? "Mixed" : undefined}
              />
            </InputGroup>
          </div>
          <div className="w-1/2">
            <FlipControls
              flipX={node.flipX ?? false}
              flipY={node.flipY ?? false}
              onFlipXChange={(value) => onUpdate({ flipX: value })}
              onFlipYChange={(value) => onUpdate({ flipY: value })}
            />
          </div>
        </div>
      </div>
      {isInsideAutoLayout && (
        <Label className="cursor-pointer mt-1">
          <Checkbox
            checked={node.absolutePosition ?? false}
            onCheckedChange={(checked) =>
              onUpdate({ absolutePosition: !!checked })
            }
          />
          Absolute position
        </Label>
      )}
    </PropertySection>
  );
}
