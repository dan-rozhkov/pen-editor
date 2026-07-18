import { useEffect, useMemo, useState } from "react";
import {
  LinkSimple,
  LinkSimpleBreak,
  ResizeIcon,
} from "@phosphor-icons/react";
import type {
  EmbedNode,
  FlatSceneNode,
  FrameNode,
  PolygonNode,
  SceneNode,
  SizingMode,
  TextNode,
} from "@/types/scene";
import { flattenTree } from "@/types/scene";
import type { FlatParentContext, ParentContext } from "@/utils/nodeUtils";
import { collectSubtreeIds } from "@/utils/nodeUtils";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useShallow } from "zustand/react/shallow";
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
import { IconButton } from "@/components/ui/IconButton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ButtonGroup } from "@/components/ui/button-group";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import { normalizeHtmlForEmbedRender } from "@/pixi/renderers/htmlTexture/foreignObject";

const sizingOptions = [
  { value: "fixed", label: "Fixed" },
  { value: "fill_container", label: "Fill" },
  { value: "fit_content", label: "Fit" },
];

const sizingModeGroupClass =
  "flex-1 h-6 rounded-md bg-secondary gap-px [&>[data-slot]]:rounded-[5px]! [&>[data-slot]]:border [&>[data-slot]~[data-slot]]:border-l";

const sizingModeButtonClass =
  "flex-1 h-full border-transparent bg-transparent text-text-muted hover:bg-surface-elevated hover:text-text-primary";

const activeSizingModeButtonClass =
  "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel";

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
  parentContext: ParentContext | FlatParentContext,
  mode: SizingMode,
  dimension: "width" | "height",
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  isMultiSelect: boolean,
  getMaterializedParent: () => FrameNode | null,
): number | undefined {
  if (mode === "fixed") return undefined;

  if (mode === "fit_content" && node.type === "frame" && !isMultiSelect) {
    // Skip the synthetic merged node of a multi-selection. It carries the FIRST
    // selected node's id (computeMergedProperties uses nodes[0] as its base,
    // multiSelectUtils.ts:46), so childrenById[node.id] resolves to that node's
    // real children — materializing it would compute an intrinsic size from one
    // arbitrary member of the selection and show it as the group's. Today's
    // `Array.isArray(node.children)` check skips this case only by accident (flat
    // nodes have no children array); once the panel passes flat nodes that
    // accident stops holding for single-select too, so discriminate explicitly.
    // materializeLayoutRefs handles both tree nodes (children array) and flat
    // nodes (children resolved via childrenById).
    const layoutFrame = materializeLayoutRefs(node as FrameNode, nodesById, childrenById);
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
    const parent = getMaterializedParent();
    if (!parent) return undefined;
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
  parentContext: ParentContext | FlatParentContext;
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
  // Narrow subscription: re-render only when a node INSIDE the relevant
  // subtree changes, not on every scene mutation. `basicMutations.ts` only
  // replaces the touched id's entry in `nodesById`/`childrenById` (see
  // updateNode), so untouched nodes keep their original object identity
  // across mutations — `useShallow` short-circuits the re-render when every
  // id in the snapshot still points at the same reference. The relevant root
  // is the auto-layout parent (covers `node` itself as a child, for
  // fill_container sizing) when inside auto-layout, otherwise `node` itself
  // (covers descendants, for fit_content sizing). Reading the maps directly
  // (via `useSceneStore.getState()`) elsewhere in this component instead of
  // subscribing to them is what makes this narrowing effective — see
  // `getMaterializedParent`/`effectiveWidth` below and the sizing-mode click
  // handlers.
  const relevantSubtreeRootId =
    parentContext.isInsideAutoLayout && parentContext.parent
      ? parentContext.parent.id
      : node.id;
  const relevantSubtreeSnapshot = useSceneStore(
    useShallow((s) =>
      collectSubtreeIds([relevantSubtreeRootId], s.childrenById).map(
        (id) => s.nodesById[id],
      ),
    ),
  );
  const updateNode = useSceneStore((s) => s.updateNode);
  const updateNodeWithoutHistory = useSceneStore((s) => s.updateNodeWithoutHistory);
  const [isFitting, setIsFitting] = useState(false);
  const [minMaxVisibleOverride, setMinMaxVisibleOverride] = useState<boolean | null>(null);

  // Memoizes a THUNK, not a value: materializing the parent's subtree is a
  // full recursive deep copy (materializeLayoutRefs), and up to three sites
  // may need it (fill_container sizing in computeSizeForMode, the reflow
  // below, and the effectiveWidth/effectiveHeight useMemo's gated branch).
  // Most renders enter none of those branches (e.g. a fixed/fixed child), so
  // the thunk lets the render path pay nothing unless something actually
  // calls it — while still sharing exactly ONE materialized instance across
  // all callers within a render (preserving the layoutCache WeakMap identity
  // hit at layoutStore.ts:63). `computed` (not `??=` on the cache alone)
  // distinguishes "not yet computed" from "gate legitimately produced null",
  // so a null result is cached and not recomputed on every call.
  const getMaterializedParent = useMemo(() => {
    let computed = false;
    let cached: FrameNode | null = null;
    return () => {
      if (!computed) {
        if (
          parentContext.isInsideAutoLayout &&
          parentContext.parent &&
          parentContext.parent.type === "frame"
        ) {
          const { nodesById, childrenById } = useSceneStore.getState();
          cached = materializeLayoutRefs(parentContext.parent as FrameNode, nodesById, childrenById);
        } else {
          cached = null;
        }
        computed = true;
      }
      return cached;
    };
    // `relevantSubtreeSnapshot` (not `nodesById`/`childrenById` directly) is
    // the recompute trigger: it only changes reference when a node inside
    // the relevant subtree actually changed, so this thunk is invalidated
    // exactly as often as the shallow-compared subscription re-renders this
    // component — see the comment on `relevantSubtreeSnapshot` above. It's
    // not referenced in the body (the lookup happens via `getState()`
    // inside the thunk), hence the lint override below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentContext.isInsideAutoLayout, parentContext.parent, relevantSubtreeSnapshot]);

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

    const parent = getMaterializedParent();
    if (!parent) return;
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

    // For fit_content frames: compute intrinsic size. Skip the synthetic merged
    // multi-select node (see the comment in computeSizeForMode).
    if (
      node.type === "frame" &&
      (node as FrameNode).layout?.autoLayout &&
      !isMultiSelect
    ) {
      const frame = node as FrameNode;
      const fitWidth = frame.sizing?.widthMode === "fit_content";
      const fitHeight = frame.sizing?.heightMode === "fit_content";
      if (fitWidth || fitHeight) {
        const { nodesById, childrenById } = useSceneStore.getState();
        const layoutFrame = materializeLayoutRefs(frame, nodesById, childrenById);
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
        const materializedParent = getMaterializedParent();
        if (materializedParent) {
          const layoutChildren = calculateLayoutForFrame(materializedParent);
          const layoutNode = layoutChildren.find((n) => n.id === node.id);
          if (layoutNode) {
            if (widthMode !== "fixed") ew = layoutNode.width;
            if (heightMode !== "fixed") eh = layoutNode.height;
          }
        }
      }
    }

    return { effectiveWidth: ew, effectiveHeight: eh };
    // `relevantSubtreeSnapshot` is the recompute trigger in place of
    // `nodesById`/`childrenById` — see the comment where it's defined above.
    // It's not referenced in the body (the lookup happens via `getState()`),
    // hence the lint override below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    node,
    parentContext,
    calculateLayoutForFrame,
    relevantSubtreeSnapshot,
    isMultiSelect,
    getMaterializedParent,
  ]);

  const canFitToContent = !isMultiSelect && (node.type === "frame" || node.type === "embed")
    ? true
    : isMultiSelect
    ? (selectedNodes ?? []).some(n => n.type === "frame" || n.type === "embed")
    : (node.type === "frame" || node.type === "embed");
  const hasMinMaxConstraints =
    node.sizing?.minWidth !== undefined ||
    node.sizing?.maxWidth !== undefined ||
    node.sizing?.minHeight !== undefined ||
    node.sizing?.maxHeight !== undefined ||
    mixedKeys?.has("sizing.minWidth") ||
    mixedKeys?.has("sizing.maxWidth") ||
    mixedKeys?.has("sizing.minHeight") ||
    mixedKeys?.has("sizing.maxHeight") ||
    false;
  const showMinMaxConstraints = minMaxVisibleOverride ?? hasMinMaxConstraints;

  useEffect(() => {
    setMinMaxVisibleOverride(null);
  }, [node.id]);

  const handleMinMaxVisibleChange = (checked: boolean) => {
    setMinMaxVisibleOverride(checked);
    if (!checked) {
      onUpdate({
        sizing: {
          ...node.sizing,
          minWidth: undefined,
          maxWidth: undefined,
          minHeight: undefined,
          maxHeight: undefined,
        },
      } as Partial<SceneNode>);
    }
  };

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
            <ButtonGroup orientation="horizontal" className={sizingModeGroupClass}>
              {sizingOptions.map((option) => (
                <Button
                  key={option.value}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    sizingModeButtonClass,
                    !mixedKeys?.has("sizing") &&
                      (node.sizing?.widthMode ?? "fixed") === option.value &&
                      activeSizingModeButtonClass,
                  )}
                  onClick={() => {
                    const newMode = option.value as SizingMode;
                    const { nodesById, childrenById } = useSceneStore.getState();
                    const computedWidth = computeSizeForMode(
                      node,
                      parentContext,
                      newMode,
                      "width",
                      calculateLayoutForFrame,
                      nodesById,
                      childrenById,
                      !!isMultiSelect,
                      getMaterializedParent,
                    );
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        widthMode: newMode,
                      },
                      ...(computedWidth !== undefined ? { width: computedWidth } : {}),
                      // Keep textWidthMode consistent: hug width = auto-width,
                      // fill/fixed width = wrap at the assigned width.
                      ...(node.type === "text"
                        ? {
                            textWidthMode:
                              newMode === "fit_content"
                                ? "auto"
                                : (node as TextNode).textWidthMode === "fixed-height"
                                  ? "fixed-height"
                                  : "fixed",
                          }
                        : {}),
                    } as Partial<SceneNode>);
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
            <ButtonGroup orientation="horizontal" className={sizingModeGroupClass}>
              {sizingOptions.map((option) => (
                <Button
                  key={option.value}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    sizingModeButtonClass,
                    !mixedKeys?.has("sizing") &&
                      (node.sizing?.heightMode ?? "fixed") === option.value &&
                      activeSizingModeButtonClass,
                  )}
                  onClick={() => {
                    const newMode = option.value as SizingMode;
                    const { nodesById, childrenById } = useSceneStore.getState();
                    const computedHeight = computeSizeForMode(
                      node,
                      parentContext,
                      newMode,
                      "height",
                      calculateLayoutForFrame,
                      nodesById,
                      childrenById,
                      !!isMultiSelect,
                      getMaterializedParent,
                    );
                    onUpdate({
                      sizing: {
                        ...node.sizing,
                        heightMode: newMode,
                      },
                      ...(computedHeight !== undefined ? { height: computedHeight } : {}),
                      // Hug height = height follows content (demote fixed-size to
                      // auto-height); fill/fixed height = fixed-size box.
                      ...(node.type === "text"
                        ? {
                            textWidthMode:
                              newMode === "fit_content"
                                ? (node as TextNode).textWidthMode === "fixed-height"
                                  ? "fixed"
                                  : ((node as TextNode).textWidthMode ?? "auto")
                                : "fixed-height",
                          }
                        : {}),
                    } as Partial<SceneNode>);
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
                generatePolygonPoints(sides, v, newH, pn.innerRadiusRatio);
            } else if (node.type === "line") {
              const scaleX = v / effectiveWidth;
              const scaleY = node.aspectRatioLocked ? newH / effectiveHeight : 1;
              const ln = node as unknown as { points: number[] };
              (updates as Record<string, unknown>).points = ln.points.map(
                (p: number, i: number) =>
                  i % 2 === 0 ? p * scaleX : p * scaleY
              );
            } else if (node.type === "text") {
              // Figma rule: typing a width fixes the width (auto -> auto-height).
              // Including the mode in the update triggers height re-measure.
              (updates as Partial<TextNode>).textWidthMode =
                (node as TextNode).textWidthMode === "fixed-height"
                  ? "fixed-height"
                  : "fixed";
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
                generatePolygonPoints(sides, newW, v, pn.innerRadiusRatio);
            } else if (node.type === "line") {
              const scaleX = node.aspectRatioLocked ? newW / effectiveWidth : 1;
              const scaleY = v / effectiveHeight;
              const ln = node as unknown as { points: number[] };
              (updates as Record<string, unknown>).points = ln.points.map(
                (p: number, i: number) =>
                  i % 2 === 0 ? p * scaleX : p * scaleY
              );
            } else if (node.type === "text") {
              // Figma rule: typing a height fixes both dimensions (fixed-size).
              (updates as Partial<TextNode>).textWidthMode = "fixed-height";
            }
            onUpdate(updates);
          }}
          min={1}
        />
        {node.type !== "text" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "shrink-0 flex items-center justify-center w-6 h-6 rounded border border-transparent",
                    node.aspectRatioLocked
                      ? "border-border-default bg-surface-panel text-text-primary hover:bg-surface-panel"
                      : "text-text-muted hover:bg-secondary"
                  )}
                  aria-label={node.aspectRatioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
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
                    <LinkSimple size={18} />
                  ) : (
                    <LinkSimpleBreak size={18} />
                  )}
                </button>
              }
            />
            <TooltipContent>
              <span>
                {node.aspectRatioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
        {canFitToContent && (
          <IconButton
            variant="secondary"
            size="icon-sm"
            tooltip={isFitting ? "Fitting..." : "Fit to content"}
            aria-label={isFitting ? "Fitting content" : "Fit to content"}
            disabled={isFitting}
            onClick={async () => {
              setIsFitting(true);
              try {
                const tree = useSceneStore.getState().getNodes();
                if (isMultiSelect && selectedNodes) {
                  const state = useSceneStore.getState();
                  saveHistory(state);
                  for (const n of selectedNodes) {
                    if (n.type === "frame") {
                      const treeNode = tree.find((a) => a.id === n.id);
                      if (treeNode && treeNode.type === "frame" && "children" in treeNode) {
                        const size = computeFrameFitToContentSize(
                          treeNode as FrameNode,
                          tree,
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
                      tree,
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
          </IconButton>
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
      {parentContext.isInsideAutoLayout && (
        <>
          <Label className="cursor-pointer mt-2">
            <Checkbox
              checked={showMinMaxConstraints}
              onCheckedChange={(checked) => handleMinMaxVisibleChange(!!checked)}
            />
            Set min/max sizes
          </Label>
          {showMinMaxConstraints && (
            <>
              <PropertyRow>
                <NumberInput
                  label="Min W"
                  value={node.sizing?.minWidth ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      sizing: { ...node.sizing, minWidth: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                  labelOutside
                  isMixed={mixedKeys?.has("sizing.minWidth")}
                />
                <NumberInput
                  label="Max W"
                  value={node.sizing?.maxWidth ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      sizing: { ...node.sizing, maxWidth: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                  labelOutside
                  isMixed={mixedKeys?.has("sizing.maxWidth")}
                />
              </PropertyRow>
              <PropertyRow>
                <NumberInput
                  label="Min H"
                  value={node.sizing?.minHeight ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      sizing: { ...node.sizing, minHeight: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                  labelOutside
                  isMixed={mixedKeys?.has("sizing.minHeight")}
                />
                <NumberInput
                  label="Max H"
                  value={node.sizing?.maxHeight ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      sizing: { ...node.sizing, maxHeight: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                  labelOutside
                  isMixed={mixedKeys?.has("sizing.maxHeight")}
                />
              </PropertyRow>
            </>
          )}
        </>
      )}
    </PropertySection>
  );
}
