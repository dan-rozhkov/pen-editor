import type { PerSideStroke, SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
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
  mixedKeys?: Set<string>;
}

type StrokeMode = "unified" | "per-side";

function getStrokeMode(node: SceneNode): StrokeMode {
  const perSide = node.strokeWidthPerSide;
  if (perSide && (perSide.top != null || perSide.right != null || perSide.bottom != null || perSide.left != null)) {
    return "per-side";
  }
  return "unified";
}

export function StrokeSection({
  node,
  onUpdate,
  component,
  colorVariables,
  activeTheme,
  isOverridden,
  resetOverride,
  mixedKeys,
}: StrokeSectionProps) {
  const hasStroke = !!(
    node.stroke ||
    (node.strokeWidth && node.strokeWidth > 0) ||
    (node.strokeWidthPerSide &&
      (node.strokeWidthPerSide.top ||
        node.strokeWidthPerSide.right ||
        node.strokeWidthPerSide.bottom ||
        node.strokeWidthPerSide.left))
  );

  const strokeMode = getStrokeMode(node);

  // Per-side stroke doesn't make sense for ellipses
  const canUsePerSide = node.type !== "ellipse";

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
      strokeAlign: undefined,
      strokeBinding: undefined,
      strokeOpacity: undefined,
      strokeWidthPerSide: undefined,
    } as Partial<SceneNode>);
  };

  const handleModeChange = (mode: string) => {
    if (mode === "per-side") {
      // Switch to per-side: copy current strokeWidth to all sides
      const currentWidth = node.strokeWidth ?? 1;
      onUpdate({
        strokeWidthPerSide: {
          top: currentWidth,
          right: currentWidth,
          bottom: currentWidth,
          left: currentWidth,
        },
        strokeWidth: undefined,
      } as Partial<SceneNode>);
    } else {
      // Switch to unified: use max of all sides
      const perSide = node.strokeWidthPerSide;
      const maxWidth = Math.max(
        perSide?.top ?? 0,
        perSide?.right ?? 0,
        perSide?.bottom ?? 0,
        perSide?.left ?? 0,
        1
      );
      onUpdate({
        strokeWidth: maxWidth,
        strokeWidthPerSide: undefined,
      } as Partial<SceneNode>);
    }
  };

  const handlePerSideChange = (side: keyof PerSideStroke, value: number) => {
    onUpdate({
      strokeWidthPerSide: {
        ...node.strokeWidthPerSide,
        [side]: value,
      },
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
          {/* Color and opacity row */}
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <ColorInput
                value={node.stroke ?? component?.stroke ?? "#000000"}
                onChange={(v) => onUpdate({ stroke: v || undefined })}
                variableId={node.strokeBinding?.variableId}
                onVariableChange={handleStrokeVariableChange}
                availableVariables={colorVariables}
                activeTheme={activeTheme}
                isMixed={mixedKeys?.has("stroke")}
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
                isMixed={mixedKeys?.has("strokeOpacity")}
              />
            </div>
            <OverrideIndicator
              isOverridden={isOverridden(node.stroke, component?.stroke)}
              onReset={() => resetOverride("stroke")}
            />
          </div>

          {/* Mode + Align row */}
          <div className="flex items-center gap-1">
            {canUsePerSide && (
              <div className="flex-1">
                <SelectInput
                  label="Mode"
                  labelOutside
                  value={strokeMode}
                  options={[
                    { value: "unified", label: "Unified" },
                    { value: "per-side", label: "Per Side" },
                  ]}
                  onChange={handleModeChange}
                />
              </div>
            )}
            <div className="flex-1">
              <SelectInput
                label="Align"
                labelOutside
                value={mixedKeys?.has("strokeAlign") ? "" : (node.strokeAlign ?? "center")}
                options={[
                  { value: "inside", label: "Inside" },
                  { value: "center", label: "Center" },
                  { value: "outside", label: "Outside" },
                ]}
                onChange={(v) => onUpdate({ strokeAlign: v as 'center' | 'inside' | 'outside' })}
                isMixed={mixedKeys?.has("strokeAlign")}
              />
            </div>
          </div>

          {/* Unified weight input */}
          {strokeMode === "unified" && (
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <NumberInput
                  label="Weight"
                  labelOutside={true}
                  value={node.strokeWidth ?? component?.strokeWidth ?? 1}
                  onChange={(v) => onUpdate({ strokeWidth: v })}
                  min={0}
                  step={0.5}
                  isMixed={mixedKeys?.has("strokeWidth")}
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
          )}

          {/* Per-side inputs */}
          {strokeMode === "per-side" && (
            <>
              <PropertyRow>
                <NumberInput
                  label="T"
                  value={node.strokeWidthPerSide?.top ?? 0}
                  onChange={(v) => handlePerSideChange("top", v)}
                  min={0}
                  step={0.5}
                />
                <NumberInput
                  label="R"
                  value={node.strokeWidthPerSide?.right ?? 0}
                  onChange={(v) => handlePerSideChange("right", v)}
                  min={0}
                  step={0.5}
                />
              </PropertyRow>
              <PropertyRow>
                <NumberInput
                  label="B"
                  value={node.strokeWidthPerSide?.bottom ?? 0}
                  onChange={(v) => handlePerSideChange("bottom", v)}
                  min={0}
                  step={0.5}
                />
                <NumberInput
                  label="L"
                  value={node.strokeWidthPerSide?.left ?? 0}
                  onChange={(v) => handlePerSideChange("left", v)}
                  min={0}
                  step={0.5}
                />
              </PropertyRow>
            </>
          )}
        </>
      )}
    </PropertySection>
  );
}
