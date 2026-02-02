import type { SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
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
  const hasStroke = !!(node.stroke || (node.strokeWidth && node.strokeWidth > 0));

  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ strokeBinding: { variableId } });
    } else {
      onUpdate({ strokeBinding: undefined });
    }
  };

  const handleAddStroke = () => {
    onUpdate({ stroke: "#000000", strokeWidth: 1 });
  };

  const handleRemoveStroke = () => {
    onUpdate({
      stroke: undefined,
      strokeWidth: undefined,
      strokeBinding: undefined,
      strokeOpacity: undefined,
    } as Partial<SceneNode>);
  };

  return (
    <PropertySection
      title="Stroke"
      action={
        !hasStroke ? (
          <Button variant="ghost" size="icon-sm" onClick={handleAddStroke}>
            <PlusIcon />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={handleRemoveStroke}>
            <MinusIcon />
          </Button>
        )
      }
    >
      {hasStroke && (
        <>
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <ColorInput
                value={node.stroke ?? component?.stroke ?? "#000000"}
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
                value={node.strokeWidth ?? component?.strokeWidth ?? 1}
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
        </>
      )}
    </PropertySection>
  );
}
