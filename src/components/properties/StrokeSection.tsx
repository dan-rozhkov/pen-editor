import type { SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";

interface StrokeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  component: SceneNode | null;
  colorVariables: Variable[];
  activeTheme: ThemeName;
  isOverridden: <T>(instanceVal: T | undefined, componentVal: T | undefined) => boolean;
  resetOverride: (property: keyof SceneNode) => void;
}

export function StrokeSection({
  node,
  onUpdate,
  component,
  colorVariables,
  activeTheme,
  isOverridden,
  resetOverride,
}: StrokeSectionProps) {
  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ strokeBinding: { variableId } });
    } else {
      onUpdate({ strokeBinding: undefined });
    }
  };

  return (
    <PropertySection title="Stroke">
      <div className="flex items-center gap-1">
        <div className="flex-1">
          <ColorInput
            value={node.stroke ?? component?.stroke ?? ""}
            onChange={(v) => onUpdate({ stroke: v || undefined })}
            variableId={node.strokeBinding?.variableId}
            onVariableChange={handleStrokeVariableChange}
            availableVariables={colorVariables}
            activeTheme={activeTheme}
          />
        </div>
        <div className="w-20">
          <NumberInput
            label="%"
            value={Math.round((node.strokeOpacity ?? 1) * 100)}
            onChange={(v) =>
              onUpdate({ strokeOpacity: Math.max(0, Math.min(100, v)) / 100 })
            }
            min={0}
            max={100}
            step={1}
          />
        </div>
        <OverrideIndicator
          isOverridden={isOverridden(node.stroke, component?.stroke)}
          onReset={() => resetOverride("stroke")}
        />
      </div>
      <div className="flex items-center gap-1">
        <div className="flex-1">
          <NumberInput
            label="Weight"
            labelOutside={true}
            value={node.strokeWidth ?? component?.strokeWidth ?? 0}
            onChange={(v) => onUpdate({ strokeWidth: v })}
            min={0}
            step={0.5}
          />
        </div>
        <OverrideIndicator
          isOverridden={isOverridden(
            node.strokeWidth,
            component?.strokeWidth
          )}
          onReset={() => resetOverride("strokeWidth")}
        />
      </div>
    </PropertySection>
  );
}
