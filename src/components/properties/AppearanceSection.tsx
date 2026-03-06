import type { FrameNode, PerCornerRadius, PolygonNode, SceneNode } from "@/types/scene";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import { hasPerCornerRadius } from "@/utils/renderUtils";

interface AppearanceSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
  allTypesSupport?: { cornerRadius: boolean };
}

type CornerRadiusMode = "unified" | "per-corner";

function getCornerRadiusMode(node: SceneNode): CornerRadiusMode {
  return hasPerCornerRadius((node as FrameNode).cornerRadiusPerCorner) ? "per-corner" : "unified";
}

export function AppearanceSection({ node, onUpdate, mixedKeys, allTypesSupport }: AppearanceSectionProps) {
  const showCornerRadius = allTypesSupport
    ? allTypesSupport.cornerRadius
    : (node.type === "frame" || node.type === "rect");

  const cornerMode = showCornerRadius ? getCornerRadiusMode(node) : "unified";

  const handleModeChange = (mode: string) => {
    if (mode === "per-corner") {
      const current = (node as FrameNode).cornerRadius ?? 0;
      onUpdate({
        cornerRadiusPerCorner: {
          topLeft: current,
          topRight: current,
          bottomRight: current,
          bottomLeft: current,
        },
        cornerRadius: undefined,
      } as Partial<SceneNode>);
    } else {
      const pcr = (node as FrameNode).cornerRadiusPerCorner;
      const maxRadius = Math.max(
        pcr?.topLeft ?? 0,
        pcr?.topRight ?? 0,
        pcr?.bottomRight ?? 0,
        pcr?.bottomLeft ?? 0,
        0,
      );
      onUpdate({
        cornerRadius: maxRadius,
        cornerRadiusPerCorner: undefined,
      } as Partial<SceneNode>);
    }
  };

  const handlePerCornerChange = (corner: keyof PerCornerRadius, value: number) => {
    onUpdate({
      cornerRadiusPerCorner: {
        ...(node as FrameNode).cornerRadiusPerCorner,
        [corner]: value,
      },
    } as Partial<SceneNode>);
  };

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
          isMixed={mixedKeys?.has("opacity")}
        />
        {showCornerRadius && cornerMode === "unified" && (
          <NumberInput
            label="Radius"
            value={(node as FrameNode).cornerRadius ?? 0}
            onChange={(v) => onUpdate({ cornerRadius: v } as Partial<SceneNode>)}
            min={0}
            labelOutside={true}
            isMixed={mixedKeys?.has("cornerRadius")}
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
      {showCornerRadius && (
        <>
          <div className="flex-1">
            <SelectInput
              label="Radius"
              labelOutside
              value={cornerMode}
              options={[
                { value: "unified", label: "Unified" },
                { value: "per-corner", label: "Per Corner" },
              ]}
              onChange={handleModeChange}
            />
          </div>
          {cornerMode === "per-corner" && (
            <>
              <PropertyRow>
                <NumberInput
                  label="TL"
                  value={(node as FrameNode).cornerRadiusPerCorner?.topLeft ?? 0}
                  onChange={(v) => handlePerCornerChange("topLeft", v)}
                  min={0}
                />
                <NumberInput
                  label="TR"
                  value={(node as FrameNode).cornerRadiusPerCorner?.topRight ?? 0}
                  onChange={(v) => handlePerCornerChange("topRight", v)}
                  min={0}
                />
              </PropertyRow>
              <PropertyRow>
                <NumberInput
                  label="BL"
                  value={(node as FrameNode).cornerRadiusPerCorner?.bottomLeft ?? 0}
                  onChange={(v) => handlePerCornerChange("bottomLeft", v)}
                  min={0}
                />
                <NumberInput
                  label="BR"
                  value={(node as FrameNode).cornerRadiusPerCorner?.bottomRight ?? 0}
                  onChange={(v) => handlePerCornerChange("bottomRight", v)}
                  min={0}
                />
              </PropertyRow>
            </>
          )}
        </>
      )}
    </PropertySection>
  );
}
