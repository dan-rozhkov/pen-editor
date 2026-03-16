import { useMemo, useState } from "react";
import {
  LinkSimple,
  LinkSimpleBreak,
  ResizeIcon,
} from "@phosphor-icons/react";
import type {
  EmbedNode,
  FrameNode,
  PolygonNode,
  SceneNode,
  SizingMode,
} from "@/types/scene";
import { flattenTree } from "@/types/scene";
import type { ParentContext } from "@/utils/nodeUtils";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { materializeLayoutRefs } from "@/utils/layoutRefUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { getPreparedNodeEffectiveSize } from "@/utils/instanceUtils";
import { saveHistory } from "@/store/sceneStore/helpers/history";
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
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import { normalizeHtmlForEmbedRender } from "@/pixi/renderers/htmlTexture/foreignObject";

const sizingOptions = [
  { value: "fixed", label: "Fixed" },
  { value: "fill_container", label: "Fill" },
  { value: "fit_content", label: "Fit" },
];

function computeFrameFitToContentSize(
  frame: FrameNode,
  allNodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { width: number; height: number } {
  const flat = flattenTree(allNodes);
  const layoutFrame = materializeLayoutRefs(
    frame,
    flat.nodesById,
    flat.childrenById,
  );

  if (frame.layout?.autoLayout) {
    const intrinsic = calculateFrameIntrinsicSize(layoutFrame, {
      fitWidth: true,
      fitHeight: true,
    });
    return {
      width: Math.max(1, intrinsic.width),
      height: Math.max(1, intrinsic.height),
    };
  }

  let maxX = 0;
  let maxY = 0;
  for (const child of layoutFrame.children) {
    if (child.visible === false || child.enabled === false) continue;
    const { width: preparedWidth, height: preparedHeight } =
      getPreparedNodeEffectiveSize(child, allNodes, calculateLayoutForFrame);
    const childWidth = Math.max(0, preparedWidth);
    const childHeight = Math.max(0, preparedHeight);
    maxX = Math.max(maxX, child.x + childWidth);
    maxY = Math.max(maxY, child.y + childHeight);
  }

  return {
    width: Math.max(1, maxX),
    height: Math.max(1, maxY),
  };
}

async function measureEmbedContentSize(
  node: EmbedNode,
): Promise<{ width: number; height: number }> {
  if (typeof document === "undefined") {
    return { width: node.width, height: node.height };
  }

  const host = document.createElement("div");
  host.style.cssText = `
    position: fixed;
    left: -99999px;
    top: -99999px;
    width: max-content;
    height: max-content;
    overflow: visible;
    pointer-events: none;
    visibility: hidden;
  `;

  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.className = "ck-preflight-root";
  container.style.cssText = `
    width: max-content;
    height: max-content;
    overflow: visible;
    margin: 0;
    padding: 0;
  `;
  const normalizedHtml = normalizeHtmlForEmbedRender(node.htmlContent);
  const { root, wrappedBody } = mountHtmlWithBodyStyles(
    container,
    normalizedHtml,
    node.width,
    node.height,
  );
  // Override constrained sizes for natural measurement
  if (wrappedBody) {
    root.style.width = "max-content";
    root.style.height = "max-content";
    root.style.overflow = "visible";
  }
  shadow.appendChild(container);
  document.body.appendChild(host);

  try {
    if ("fonts" in document) {
      const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
      if (fontsReady) {
        await Promise.race([
          fontsReady,
          new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
      }
    }

    await Promise.all(
      Array.from(root.querySelectorAll("img")).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.onload = img.onerror = () => resolve();
            }),
      ),
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const rect = root.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  } finally {
    document.body.removeChild(host);
  }
}

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
  allNodes: SceneNode[],
): number | undefined {
  if (mode === "fixed") return undefined;

  if (mode === "fit_content" && node.type === "frame") {
    if (!("children" in node) || !Array.isArray((node as any).children)) {
      return undefined;
    }
    const frame = node as FrameNode;
    const flat = flattenTree(allNodes);
    const layoutFrame = materializeLayoutRefs(
      frame,
      flat.nodesById,
      flat.childrenById,
    );
    const intrinsic = calculateFrameIntrinsicSize(layoutFrame, {
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
  selectedNodes?: SceneNode[];
  showSizingModes?: boolean;
  useDirectUpdateOnly?: boolean;
}

export function SizeSection({
  node,
  onUpdate,
  parentContext,
  mixedKeys,
  isMultiSelect,
  selectedNodes,
  showSizingModes,
  useDirectUpdateOnly = false,
}: SizeSectionProps) {
  const calculateLayoutForFrame = useLayoutStore((s) => s.calculateLayoutForFrame);
  const allNodes = useSceneStore((s) => s.getNodes());
  const updateNode = useSceneStore((s) => s.updateNode);
  const updateNodeWithoutHistory = useSceneStore((s) => s.updateNodeWithoutHistory);
  const [isFitting, setIsFitting] = useState(false);

  const reflowAutoLayoutSiblings = (
    dimension: "width" | "height",
    newMode: SizingMode,
    computedSize?: number,
  ) => {
    if (
      !parentContext.isInsideAutoLayout ||
      !parentContext.parent ||
      parentContext.parent.type !== "frame"
    ) {
      return;
    }

    const parent = parentContext.parent as FrameNode;
    const sizingKey = dimension === "width" ? "widthMode" : "heightMode";
    const modifiedChildren = parent.children.map((child) => {
      if (child.id !== node.id) return child;
      return {
        ...child,
        sizing: {
          ...child.sizing,
          [sizingKey]: newMode,
        },
        ...(computedSize !== undefined ? { [dimension]: computedSize } : {}),
      };
    });
    const modifiedParent = { ...parent, children: modifiedChildren } as FrameNode;
    const layoutChildren = calculateLayoutForFrame(modifiedParent);
    const childById = new Map(modifiedChildren.map((child) => [child.id, child]));

    for (const laidOutChild of layoutChildren) {
      const sourceChild = childById.get(laidOutChild.id);
      if (!sourceChild) continue;
      const widthMode = sourceChild.sizing?.widthMode ?? "fixed";
      const heightMode = sourceChild.sizing?.heightMode ?? "fixed";
      const updates: Partial<SceneNode> = {};
      if (widthMode !== "fixed" && sourceChild.width !== laidOutChild.width) {
        updates.width = laidOutChild.width;
      }
      if (heightMode !== "fixed" && sourceChild.height !== laidOutChild.height) {
        updates.height = laidOutChild.height;
      }
      if (!useDirectUpdateOnly && (updates.width !== undefined || updates.height !== undefined)) {
        updateNodeWithoutHistory(laidOutChild.id, updates);
      }
    }
  };

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
        const flat = flattenTree(allNodes);
        const layoutFrame = materializeLayoutRefs(
          frame,
          flat.nodesById,
          flat.childrenById,
        );
        const intrinsicSize = calculateFrameIntrinsicSize(layoutFrame, {
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
  }, [node, parentContext, calculateLayoutForFrame, allNodes]);

  const canFitToContent = !isMultiSelect && (node.type === "frame" || node.type === "embed")
    ? true
    : isMultiSelect
    ? (selectedNodes ?? []).some(n => n.type === "frame" || n.type === "embed")
    : (node.type === "frame" || node.type === "embed");

  return (
    <PropertySection title="Size">
      {(parentContext.isInsideAutoLayout ||
        node.type === "frame" ||
        node.type === "ref" ||
        showSizingModes) && (
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
                    !mixedKeys?.has("sizing") && (node.sizing?.widthMode ?? "fixed") === option.value
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    !mixedKeys?.has("sizing") && (node.sizing?.widthMode ?? "fixed") === option.value
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
                      allNodes,
                    );
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        widthMode: newMode,
                      },
                      ...(computedWidth !== undefined ? { width: computedWidth } : {}),
                    });
                    if (!isMultiSelect && !useDirectUpdateOnly) {
                      reflowAutoLayoutSiblings("width", newMode, computedWidth);
                    }
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
                    !mixedKeys?.has("sizing") && (node.sizing?.heightMode ?? "fixed") === option.value
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    !mixedKeys?.has("sizing") && (node.sizing?.heightMode ?? "fixed") === option.value
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
                      allNodes,
                    );
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        heightMode: newMode,
                      },
                      ...(computedHeight !== undefined ? { height: computedHeight } : {}),
                    });
                    if (!isMultiSelect && !useDirectUpdateOnly) {
                      reflowAutoLayoutSiblings("height", newMode, computedHeight);
                    }
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
        {<button
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
            <LinkSimple size={14} />
          ) : (
            <LinkSimpleBreak size={14} />
          )}
        </button>}
        {canFitToContent && (
          <Button
            variant="secondary"
            size="icon-sm"
            title={isFitting ? "Fitting..." : "Fit to content"}
            aria-label={isFitting ? "Fitting content" : "Fit to content"}
            disabled={isFitting}
            onClick={async () => {
              setIsFitting(true);
              try {
                if (isMultiSelect && selectedNodes) {
                  const state = useSceneStore.getState();
                  saveHistory(state);
                  for (const n of selectedNodes) {
                    if (n.type === "frame") {
                      const treeNode = allNodes.find(a => a.id === n.id);
                      if (treeNode && treeNode.type === "frame" && "children" in treeNode) {
                        const size = computeFrameFitToContentSize(
                          treeNode as FrameNode,
                          allNodes,
                          calculateLayoutForFrame,
                        );
                        updateNodeWithoutHistory(n.id, size);
                      }
                    } else if (n.type === "embed") {
                      const size = await measureEmbedContentSize(n as EmbedNode);
                      updateNodeWithoutHistory(n.id, size);
                    }
                  }
                } else {
                  if (node.type === "frame") {
                    const size = computeFrameFitToContentSize(
                      node,
                      allNodes,
                      calculateLayoutForFrame,
                    );
                    if (useDirectUpdateOnly) {
                      onUpdate(size);
                    } else {
                      updateNode(node.id, size);
                    }
                  } else if (node.type === "embed") {
                    const size = await measureEmbedContentSize(node);
                    if (useDirectUpdateOnly) {
                      onUpdate(size);
                    } else {
                      updateNode(node.id, size);
                    }
                  }
                }
              } finally {
                setIsFitting(false);
              }
            }}
          >
            <ResizeIcon />
          </Button>
        )}
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
