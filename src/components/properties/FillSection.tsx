import type { GradientFill, GradientType, SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { GradientEditor } from "@/components/properties/GradientEditor";
import { ImageFillEditor } from "@/components/properties/ImageFillSection";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";
import { getDefaultGradient } from "@/utils/gradientUtils";

interface FillSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  component: SceneNode | null;
  colorVariables: Variable[];
  activeTheme: ThemeName;
  isOverridden: <T>(instanceVal: T | undefined, componentVal: T | undefined) => boolean;
  resetOverride: (property: keyof SceneNode) => void;
  mixedKeys?: Set<string>;
}

export function FillSection({
  node,
  onUpdate,
  component,
  colorVariables,
  activeTheme,
  isOverridden,
  resetOverride,
  mixedKeys,
}: FillSectionProps) {
  const hasFill = !!(node.fill || node.gradientFill || node.imageFill);

  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ fillBinding: { variableId } });
    } else {
      onUpdate({ fillBinding: undefined });
    }
  };

  const handleAddFill = () => {
    onUpdate({ fill: "#000000" });
  };

  const handleRemoveFill = () => {
    onUpdate({
      fill: undefined,
      gradientFill: undefined,
      imageFill: undefined,
      fillBinding: undefined,
      fillOpacity: undefined,
    } as Partial<SceneNode>);
  };

  const supportsImage =
    node.type === "rect" ||
    node.type === "ellipse" ||
    node.type === "frame";
  const fillMode = node.imageFill
    ? "image"
    : node.gradientFill?.type ?? "solid";
  const fillOptions = [
    { value: "solid", label: "Solid" },
    { value: "linear", label: "Linear" },
    { value: "radial", label: "Radial" },
    ...(supportsImage ? [{ value: "image", label: "Image" }] : []),
  ];

  return (
    <PropertySection
      title="Fill"
      action={
        !hasFill ? (
          <Button variant="ghost" size="icon-sm" onClick={handleAddFill}>
            <PlusIcon />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={handleRemoveFill}>
            <MinusIcon />
          </Button>
        )
      }
    >
      {hasFill && (
        <>
          <SelectInput
            value={fillMode}
            options={fillOptions}
            onChange={(v) => {
              if (v === "image") {
                const updates: Partial<SceneNode> = {
                  gradientFill: undefined,
                } as Partial<SceneNode>;
                if (!node.imageFill) {
                  (updates as Record<string, unknown>).imageFill = {
                    url: "",
                    mode: "fill",
                  };
                }
                onUpdate(updates);
              } else if (v === "solid") {
                onUpdate({
                  gradientFill: undefined,
                  imageFill: undefined,
                } as Partial<SceneNode>);
              } else {
                const currentGradient = node.gradientFill;
                const updates: Partial<SceneNode> = {
                  imageFill: undefined,
                } as Partial<SceneNode>;
                if (currentGradient && currentGradient.type !== v) {
                  updates.gradientFill = {
                    ...getDefaultGradient(v as GradientType),
                    stops: currentGradient.stops,
                  };
                } else if (!currentGradient) {
                  updates.gradientFill = getDefaultGradient(
                    v as GradientType
                  );
                }
                onUpdate(updates);
              }
            }}
          />
          {fillMode === "image" ? (
            <ImageFillEditor
              imageFill={node.imageFill}
              onUpdate={onUpdate}
            />
          ) : node.gradientFill ? (
            <GradientEditor
              gradient={node.gradientFill}
              onChange={(g: GradientFill) => onUpdate({ gradientFill: g })}
            />
          ) : (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ColorInput
                  value={node.fill ?? component?.fill ?? "#000000"}
                  onChange={(v) => onUpdate({ fill: v })}
                  variableId={node.fillBinding?.variableId}
                  onVariableChange={handleFillVariableChange}
                  availableVariables={colorVariables}
                  activeTheme={activeTheme}
                  isMixed={mixedKeys?.has("fill")}
                />
              </div>
              <div className="w-20">
                <NumberInput
                  label="%"
                  value={Math.round((node.fillOpacity ?? 1) * 100)}
                  onChange={(v) =>
                    onUpdate({
                      fillOpacity: Math.max(0, Math.min(100, v)) / 100,
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                  isMixed={mixedKeys?.has("fillOpacity")}
                />
              </div>
              <OverrideIndicator
                isOverridden={isOverridden(node.fill, component?.fill)}
                onReset={() => resetOverride("fill")}
              />
            </div>
          )}
        </>
      )}
    </PropertySection>
  );
}
