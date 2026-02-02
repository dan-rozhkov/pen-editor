import type { PolygonNode, SceneNode } from "@/types/scene";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { generatePolygonPoints } from "@/utils/polygonUtils";

interface AppearanceSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function AppearanceSection({ node, onUpdate }: AppearanceSectionProps) {
  return (
    <PropertySection title="Appearance">
      <PropertyRow>
        <NumberInput
          label="Opacity %"
          value={Math.round((node.opacity ?? 1) * 100)}
          onChange={(v) =>
            onUpdate({ opacity: Math.max(0, Math.min(100, v)) / 100 })
          }
          min={0}
          max={100}
          step={1}
          labelOutside={true}
        />
        {(node.type === "frame" || node.type === "rect") && (
          <NumberInput
            label="Radius"
            value={node.cornerRadius ?? 0}
            onChange={(v) => onUpdate({ cornerRadius: v })}
            min={0}
            labelOutside={true}
          />
        )}
        {node.type === "polygon" && (
          <NumberInput
            label="Sides"
            value={(node as PolygonNode).sides ?? 6}
            onChange={(v) => {
              const sides = Math.max(3, Math.min(12, v));
              const points = generatePolygonPoints(
                sides,
                node.width,
                node.height
              );
              onUpdate({ sides, points } as Partial<SceneNode>);
            }}
            min={3}
            max={12}
            step={1}
            labelOutside={true}
          />
        )}
      </PropertyRow>
    </PropertySection>
  );
}
