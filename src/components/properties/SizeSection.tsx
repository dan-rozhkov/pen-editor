import { useMemo } from "react";
import { LinkSimple, LinkSimpleBreak } from "@phosphor-icons/react";
import type { FrameNode, PolygonNode, SceneNode, SizingMode } from "@/types/scene";
import type { ParentContext } from "@/utils/nodeUtils";
import { useLayoutStore } from "@/store/layoutStore";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { cn } from "@/lib/utils";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { generatePolygonPoints } from "@/utils/polygonUtils";

const sizingOptions = [
  { value: "fixed", label: "Fixed" },
  { value: "fill_container", label: "Fill" },
  { value: "fit_content", label: "Fit" },
];

/**
 * Compute the effective size a node would have in a given sizing mode.
 * Returns undefined when the mode is "fixed" or computation isn't applicable.
 */
function computeSizeForMode(
  node: SceneNode,
  parentContext: ParentContext,
  mode: SizingMode,
  dimension: "width" | "height",
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): number | undefined {
  if (mode === "fixed") return undefined;

  if (mode === "fit_content" && node.type === "frame") {
    if (!("children" in node) || !Array.isArray((node as any).children)) {
      return undefined;
    }
    const frame = node as FrameNode;
    const intrinsic = calculateFrameIntrinsicSize(frame, {
      fitWidth: dimension === "width",
      fitHeight: dimension === "height",
    });
    return dimension === "width" ? intrinsic.width : intrinsic.height;
  }

  if (
    mode === "fill_container" &&
    parentContext.isInsideAutoLayout &&
    parentContext.parent &&
    parentContext.parent.type === "frame"
  ) {
    const parent = parentContext.parent as FrameNode;
    const sizingKey = dimension === "width" ? "widthMode" : "heightMode";
    const modifiedChildren = parent.children.map((child) => {
      if (child.id !== node.id) return child;
      return {
        ...child,
        sizing: {
          ...child.sizing,
          [sizingKey]: "fill_container" as SizingMode,
        },
      };
    });
    const modifiedParent = { ...parent, children: modifiedChildren } as FrameNode;
    const layoutChildren = calculateLayoutForFrame(modifiedParent);
    const layoutNode = layoutChildren.find((n) => n.id === node.id);
    if (layoutNode) {
      return dimension === "width" ? layoutNode.width : layoutNode.height;
    }
  }

  return undefined;
}

interface SizeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  parentContext: ParentContext;
  mixedKeys?: Set<string>;
  isMultiSelect?: boolean;
}

export function SizeSection({ node, onUpdate, parentContext, mixedKeys, isMultiSelect }: SizeSectionProps) {
  const calculateLayoutForFrame = useLayoutStore((s) => s.calculateLayoutForFrame);

  const { effectiveWidth, effectiveHeight } = useMemo(() => {
    let ew = node.width;
    let eh = node.height;

    // For fit_content frames: compute intrinsic size
    if (
      node.type === "frame" &&
      ("children" in node) &&
      Array.isArray((node as any).children) &&
      (node as FrameNode).layout?.autoLayout
    ) {
      const frame = node as FrameNode;
      const fitWidth = frame.sizing?.widthMode === "fit_content";
      const fitHeight = frame.sizing?.heightMode === "fit_content";
      if (fitWidth || fitHeight) {
        const intrinsicSize = calculateFrameIntrinsicSize(frame, {
          fitWidth,
          fitHeight,
        });
        if (fitWidth) ew = intrinsicSize.width;
        if (fitHeight) eh = intrinsicSize.height;
      }
    }

    // For nodes in auto-layout parent with non-fixed sizing mode
    if (
      parentContext.isInsideAutoLayout &&
      parentContext.parent &&
      parentContext.parent.type === "frame"
    ) {
      const widthMode = node.sizing?.widthMode ?? "fixed";
      const heightMode = node.sizing?.heightMode ?? "fixed";
      if (widthMode !== "fixed" || heightMode !== "fixed") {
        const layoutChildren = calculateLayoutForFrame(parentContext.parent as FrameNode);
        const layoutNode = layoutChildren.find((n) => n.id === node.id);
        if (layoutNode) {
          if (widthMode !== "fixed") ew = layoutNode.width;
          if (heightMode !== "fixed") eh = layoutNode.height;
        }
      }
    }

    return { effectiveWidth: ew, effectiveHeight: eh };
  }, [node, parentContext, calculateLayoutForFrame]);

  return (
    <PropertySection title="Size">
      {!isMultiSelect && (parentContext.isInsideAutoLayout ||
        (node.type === "frame" && node.layout?.autoLayout)) && (
        <>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-text-muted w-4 shrink-0">
              W
            </span>
            <ButtonGroup orientation="horizontal" className="flex-1">
              {sizingOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={
                    (node.sizing?.widthMode ?? "fixed") === option.value
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    (node.sizing?.widthMode ?? "fixed") === option.value
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
                      : ""
                  }`}
                  onClick={() => {
                    const newMode = option.value as SizingMode;
                    const computedWidth = computeSizeForMode(
                      node,
                      parentContext,
                      newMode,
                      "width",
                      calculateLayoutForFrame,
                    );
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        widthMode: newMode,
                      },
                      ...(computedWidth !== undefined ? { width: computedWidth } : {}),
                    });
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </ButtonGroup>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-text-muted w-4 shrink-0">
              H
            </span>
            <ButtonGroup orientation="horizontal" className="flex-1">
              {sizingOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={
                    (node.sizing?.heightMode ?? "fixed") === option.value
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    (node.sizing?.heightMode ?? "fixed") === option.value
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
                      : ""
                  }`}
                  onClick={() => {
                    const newMode = option.value as SizingMode;
                    const computedHeight = computeSizeForMode(
                      node,
                      parentContext,
                      newMode,
                      "height",
                      calculateLayoutForFrame,
                    );
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        heightMode: newMode,
                      },
                      ...(computedHeight !== undefined ? { height: computedHeight } : {}),
                    });
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </ButtonGroup>
          </div>
        </>
      )}
      <PropertyRow>
        <NumberInput
          label="W"
          value={effectiveWidth}
          isMixed={mixedKeys?.has("width")}
          onChange={(v) => {
            const ratio = node.aspectRatio ?? (effectiveWidth / effectiveHeight);
            const newH = node.aspectRatioLocked
              ? Math.round(v / ratio)
              : node.height;
            const updates: Partial<SceneNode> = {
              width: v,
              ...(node.aspectRatioLocked ? { height: newH } : {}),
            };
            if (node.type === "polygon") {
              const pn = node as PolygonNode;
              const sides = pn.sides ?? 6;
              (updates as Partial<PolygonNode>).points =
                generatePolygonPoints(sides, v, newH);
            } else if (node.type === "line") {
              const scaleX = v / effectiveWidth;
              const scaleY = node.aspectRatioLocked ? newH / effectiveHeight : 1;
              const ln = node as unknown as { points: number[] };
              (updates as Record<string, unknown>).points = ln.points.map(
                (p: number, i: number) =>
                  i % 2 === 0 ? p * scaleX : p * scaleY
              );
            }
            onUpdate(updates);
          }}
          min={1}
        />
        <NumberInput
          label="H"
          value={effectiveHeight}
          isMixed={mixedKeys?.has("height")}
          onChange={(v) => {
            const ratio = node.aspectRatio ?? (effectiveWidth / effectiveHeight);
            const newW = node.aspectRatioLocked
              ? Math.round(v * ratio)
              : node.width;
            const updates: Partial<SceneNode> = {
              height: v,
              ...(node.aspectRatioLocked ? { width: newW } : {}),
            };
            if (node.type === "polygon") {
              const pn = node as PolygonNode;
              const sides = pn.sides ?? 6;
              (updates as Partial<PolygonNode>).points =
                generatePolygonPoints(sides, newW, v);
            } else if (node.type === "line") {
              const scaleX = node.aspectRatioLocked ? newW / effectiveWidth : 1;
              const scaleY = v / effectiveHeight;
              const ln = node as unknown as { points: number[] };
              (updates as Record<string, unknown>).points = ln.points.map(
                (p: number, i: number) =>
                  i % 2 === 0 ? p * scaleX : p * scaleY
              );
            }
            onUpdate(updates);
          }}
          min={1}
        />
        {!isMultiSelect && <button
          type="button"
          className={cn(
            "shrink-0 flex items-center justify-center w-6 h-6 rounded",
            node.aspectRatioLocked
              ? "text-sky-600 bg-sky-100 hover:bg-sky-200"
              : "text-text-muted hover:bg-surface-hover"
          )}
          title={node.aspectRatioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
          onClick={() =>
            onUpdate({
              aspectRatioLocked: !node.aspectRatioLocked,
              ...(!node.aspectRatioLocked
                ? { aspectRatio: effectiveWidth / effectiveHeight }
                : {}),
            })
          }
        >
          {node.aspectRatioLocked ? (
            <LinkSimple size={14} weight="bold" />
          ) : (
            <LinkSimpleBreak size={14} />
          )}
        </button>}
      </PropertyRow>
      {node.type === "frame" && (
        <Label className="cursor-pointer">
          <Checkbox
            checked={(node as FrameNode).clip ?? false}
            onCheckedChange={(checked) => onUpdate({ clip: !!checked })}
          />
          Clip content
        </Label>
      )}
    </PropertySection>
  );
}
