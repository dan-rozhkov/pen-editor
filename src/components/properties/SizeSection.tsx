import { LinkSimple, LinkSimpleBreak } from "@phosphor-icons/react";
import type { FrameNode, PolygonNode, SceneNode, SizingMode } from "@/types/scene";
import type { ParentContext } from "@/utils/nodeUtils";
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

interface SizeSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  parentContext: ParentContext;
  mixedKeys?: Set<string>;
  isMultiSelect?: boolean;
}

export function SizeSection({ node, onUpdate, parentContext, mixedKeys, isMultiSelect }: SizeSectionProps) {
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
                  onClick={() =>
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        widthMode: option.value as SizingMode,
                      },
                    })
                  }
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
                  onClick={() =>
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        heightMode: option.value as SizingMode,
                      },
                    })
                  }
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
          value={node.width}
          isMixed={mixedKeys?.has("width")}
          onChange={(v) => {
            const ratio = node.aspectRatio ?? (node.width / node.height);
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
              const scaleX = v / node.width;
              const scaleY = node.aspectRatioLocked ? newH / node.height : 1;
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
          value={node.height}
          isMixed={mixedKeys?.has("height")}
          onChange={(v) => {
            const ratio = node.aspectRatio ?? (node.width / node.height);
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
              const scaleX = node.aspectRatioLocked ? newW / node.width : 1;
              const scaleY = v / node.height;
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
                ? { aspectRatio: node.width / node.height }
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
