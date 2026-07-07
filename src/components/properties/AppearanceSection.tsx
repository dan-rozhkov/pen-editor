import type { EllipseNode, FrameNode, PerCornerRadius, PolygonNode, SceneNode } from "@/types/scene";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { generatePolygonPoints, isStarRatio } from "@/utils/polygonUtils";
import { hasPerCornerRadius } from "@/utils/renderUtils";
import { Angle, Asterisk, CornersOut } from "@phosphor-icons/react";
import clsx from "clsx";

interface AppearanceSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
  allTypesSupport?: { cornerRadius: boolean };
  hideOpacity?: boolean;
}

type CornerRadiusMode = "unified" | "per-corner";

function getCornerRadiusMode(node: SceneNode): CornerRadiusMode {
  return hasPerCornerRadius((node as FrameNode).cornerRadiusPerCorner) ? "per-corner" : "unified";
}

export function AppearanceSection({
  node,
  onUpdate,
  mixedKeys,
  allTypesSupport,
  hideOpacity = false,
}: AppearanceSectionProps) {
  const showCornerRadius = allTypesSupport
    ? allTypesSupport.cornerRadius
    : (node.type === "frame" || node.type === "rect");

  const cornerMode = showCornerRadius ? getCornerRadiusMode(node) : "unified";
  const polygonNode = node.type === "polygon" ? (node as PolygonNode) : null;
  const isStar = isStarRatio(polygonNode?.innerRadiusRatio);

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
        {!hideOpacity && (
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
        )}
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
        {showCornerRadius && (
          <button
            type="button"
            title={cornerMode === "unified" ? "Per corner radius" : "Unified radius"}
            className={clsx(
              "shrink-0 flex items-center justify-center w-6 h-6 rounded self-end border border-transparent",
              cornerMode === "per-corner"
                ? "border-border-default bg-surface-panel text-text-primary hover:bg-surface-panel"
                : "text-text-muted hover:bg-secondary"
            )}
            onClick={() => handleModeChange(cornerMode === "unified" ? "per-corner" : "unified")}
          >
            <CornersOut size={18} />
          </button>
        )}
        {polygonNode && !isStar && (
          <NumberInput
            label="Sides"
            value={polygonNode.sides ?? 6}
            onChange={(v) => {
              const sides = Math.max(3, Math.min(12, v));
              const innerRadiusRatio = polygonNode.innerRadiusRatio;
              const points = generatePolygonPoints(
                sides,
                node.width,
                node.height,
                innerRadiusRatio
              );
              onUpdate({ sides, points } as Partial<SceneNode>);
            }}
            min={3}
            max={12}
            step={1}
            labelOutside={true}
            icon={<Asterisk size={14} />}
          />
        )}
      </PropertyRow>
      {polygonNode && isStar && (
        <PropertyRow>
          <NumberInput
            label="Points"
            value={polygonNode.sides ?? 6}
            onChange={(v) => {
              const sides = Math.max(3, Math.min(12, v));
              const innerRadiusRatio = polygonNode.innerRadiusRatio;
              const points = generatePolygonPoints(
                sides,
                node.width,
                node.height,
                innerRadiusRatio
              );
              onUpdate({ sides, points } as Partial<SceneNode>);
            }}
            min={3}
            max={12}
            step={1}
            labelOutside={true}
            icon={<Asterisk size={14} />}
          />
          <NumberInput
            label="Ratio, %"
            value={Math.round((polygonNode.innerRadiusRatio ?? 0.5) * 100)}
            onChange={(v) => {
              const innerRadiusRatio = Math.max(1, Math.min(99, v)) / 100;
              const sides = polygonNode.sides ?? 6;
              const points = generatePolygonPoints(sides, node.width, node.height, innerRadiusRatio);
              onUpdate({ innerRadiusRatio, points } as Partial<SceneNode>);
            }}
            min={1}
            max={99}
            step={1}
            labelOutside={true}
            icon={<Angle size={14} />}
          />
        </PropertyRow>
      )}
      {node.type === "ellipse" && (
        <>
          <PropertyRow>
            <NumberInput
              label="Start °"
              value={(node as EllipseNode).startAngle ?? 0}
              onChange={(v) => onUpdate({ startAngle: v } as Partial<SceneNode>)}
              step={1}
              labelOutside={true}
            />
            <NumberInput
              label="Sweep °"
              value={(node as EllipseNode).sweepAngle ?? 360}
              onChange={(v) =>
                onUpdate({ sweepAngle: Math.max(-360, Math.min(360, v)) } as Partial<SceneNode>)
              }
              min={-360}
              max={360}
              step={1}
              labelOutside={true}
            />
          </PropertyRow>
          <PropertyRow>
            <NumberInput
              label="Ratio, %"
              value={Math.round(((node as EllipseNode).innerRadiusRatio ?? 0) * 100)}
              onChange={(v) =>
                onUpdate({
                  innerRadiusRatio: Math.max(0, Math.min(99, v)) / 100,
                } as Partial<SceneNode>)
              }
              min={0}
              max={99}
              step={1}
              labelOutside={true}
            />
          </PropertyRow>
        </>
      )}
      {showCornerRadius && cornerMode === "per-corner" && (
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
      {showCornerRadius && (
        <PropertyRow>
          <NumberInput
            label="Smoothing %"
            value={Math.round(((node as FrameNode).cornerSmoothing ?? 0) * 100)}
            onChange={(v) =>
              onUpdate({
                cornerSmoothing: Math.max(0, Math.min(100, v)) / 100,
              } as Partial<SceneNode>)
            }
            min={0}
            max={100}
            step={1}
            labelOutside={true}
            isMixed={mixedKeys?.has("cornerSmoothing")}
          />
        </PropertyRow>
      )}
    </PropertySection>
  );
}
