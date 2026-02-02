import { ArrowClockwise } from "@phosphor-icons/react";
import type { SceneNode } from "@/types/scene";
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

interface PositionSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function PositionSection({ node, onUpdate }: PositionSectionProps) {
  return (
    <PropertySection title="Position">
      <PropertyRow>
        <NumberInput
          label="X"
          value={node.x}
          onChange={(v) => onUpdate({ x: v })}
        />
        <NumberInput
          label="Y"
          value={node.y}
          onChange={(v) => onUpdate({ y: v })}
        />
      </PropertyRow>
      <div className="flex gap-2 mt-2">
        <div className="w-1/2">
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <ArrowClockwise size={14} />
            </InputGroupAddon>
            <InputGroupInput
              type="number"
              value={Math.round((node.rotation ?? 0) * 100) / 100}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                  onUpdate({ rotation: val });
                }
              }}
              min={0}
              max={360}
              step={1}
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
    </PropertySection>
  );
}
