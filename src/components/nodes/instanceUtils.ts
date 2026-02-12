import type {
  DescendantOverrides,
  FrameNode,
  GroupNode,
  RefNode,
  SceneNode,
} from "@/types/scene";
import { applyAutoLayoutRecursively } from "@/utils/autoLayoutUtils";
import { findComponentById } from "@/utils/componentUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { applyDescendantOverride } from "./renderUtils";

export interface PreparedInstanceNode {
  component: FrameNode;
  preparedComponent: FrameNode;
  layoutChildren: SceneNode[];
  effectiveWidth: number;
  effectiveHeight: number;
}

export interface PreparedFrameNode {
  layoutChildren: SceneNode[];
  effectiveWidth: number;
  effectiveHeight: number;
}

export function prepareFrameNode(
  frameNode: FrameNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): PreparedFrameNode {
  const layoutChildren = frameNode.layout?.autoLayout
    ? calculateLayoutForFrame(frameNode)
    : frameNode.children;
  const fitWidth =
    frameNode.layout?.autoLayout && frameNode.sizing?.widthMode === "fit_content";
  const fitHeight =
    frameNode.layout?.autoLayout && frameNode.sizing?.heightMode === "fit_content";
  const intrinsicSize =
    fitWidth || fitHeight
      ? calculateFrameIntrinsicSize(frameNode, { fitWidth, fitHeight })
      : null;

  return {
    layoutChildren,
    effectiveWidth: fitWidth && intrinsicSize ? intrinsicSize.width : frameNode.width,
    effectiveHeight: fitHeight && intrinsicSize ? intrinsicSize.height : frameNode.height,
  };
}

export function resolveRefToFrame(
  refNode: RefNode,
  allNodes: SceneNode[],
): FrameNode | null {
  const component = findComponentById(allNodes, refNode.componentId);
  if (!component) return null;

  const resolvedChildren = component.children.map((child) => {
    const slotRepl =
      child.type === "ref" ? refNode.slotContent?.[child.id] : undefined;
    const descOverride = refNode.descendants?.[child.id];
    return slotRepl ?? applyDescendantOverride(child, descOverride);
  });

  return {
    ...component,
    id: refNode.id,
    name: refNode.name ?? component.name,
    x: refNode.x,
    y: refNode.y,
    width: refNode.width,
    height: refNode.height,
    ...(refNode.fill !== undefined && { fill: refNode.fill }),
    ...(refNode.fillBinding !== undefined && {
      fillBinding: refNode.fillBinding,
    }),
    ...(refNode.fillOpacity !== undefined && {
      fillOpacity: refNode.fillOpacity,
    }),
    ...(refNode.stroke !== undefined && { stroke: refNode.stroke }),
    ...(refNode.strokeBinding !== undefined && {
      strokeBinding: refNode.strokeBinding,
    }),
    ...(refNode.strokeWidth !== undefined && {
      strokeWidth: refNode.strokeWidth,
    }),
    ...(refNode.strokeOpacity !== undefined && {
      strokeOpacity: refNode.strokeOpacity,
    }),
    ...(refNode.gradientFill !== undefined && {
      gradientFill: refNode.gradientFill,
    }),
    ...(refNode.opacity !== undefined && { opacity: refNode.opacity }),
    ...(refNode.imageFill !== undefined && { imageFill: refNode.imageFill }),
    type: "frame",
    reusable: false,
    children: resolvedChildren,
  };
}

export function resolveNodeWithInstanceOverrides(
  node: SceneNode,
  rootDescendantOverrides: DescendantOverrides,
  slotContent: Record<string, SceneNode> | undefined,
  allNodes: SceneNode[],
  localDescendantOverrides?: DescendantOverrides,
): SceneNode {
  const override =
    localDescendantOverrides?.[node.id] ?? rootDescendantOverrides[node.id];
  const slotReplacement =
    node.type === "ref" ? slotContent?.[node.id] : undefined;

  let resolvedNode = slotReplacement ?? applyDescendantOverride(node, override);
  if (resolvedNode.type === "ref") {
    resolvedNode = resolveRefToFrame(resolvedNode as RefNode, allNodes) ?? resolvedNode;
  }

  if (resolvedNode.type === "frame" || resolvedNode.type === "group") {
    const children = (resolvedNode as FrameNode | GroupNode).children.map((child) =>
      resolveNodeWithInstanceOverrides(
        child,
        rootDescendantOverrides,
        slotContent,
        allNodes,
        override?.descendants,
      ),
    );
    return { ...resolvedNode, children } as SceneNode;
  }

  return resolvedNode;
}

export function prepareInstanceNode(
  instanceNode: RefNode,
  allNodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): PreparedInstanceNode | null {
  const component = findComponentById(allNodes, instanceNode.componentId);
  if (!component) return null;

  const descendantOverrides = instanceNode.descendants || {};
  const resolvedComponentForLayout: FrameNode = {
    ...component,
    children: component.children.map((child) =>
      resolveNodeWithInstanceOverrides(
        child,
        descendantOverrides,
        instanceNode.slotContent,
        allNodes,
      ),
    ),
  };

  const preparedComponent = applyAutoLayoutRecursively(
    resolvedComponentForLayout,
    calculateLayoutForFrame,
  ) as FrameNode;
  const layoutChildren = preparedComponent.children;

  const effectiveWidthMode =
    instanceNode.sizing?.widthMode ?? preparedComponent.sizing?.widthMode ?? "fixed";
  const effectiveHeightMode =
    instanceNode.sizing?.heightMode ?? preparedComponent.sizing?.heightMode ?? "fixed";
  const fitWidth = effectiveWidthMode === "fit_content";
  const fitHeight = effectiveHeightMode === "fit_content";
  const intrinsicSize =
    preparedComponent.layout?.autoLayout && (fitWidth || fitHeight)
      ? calculateFrameIntrinsicSize(preparedComponent, { fitWidth, fitHeight })
      : null;

  return {
    component,
    preparedComponent,
    layoutChildren,
    effectiveWidth: fitWidth && intrinsicSize ? intrinsicSize.width : instanceNode.width,
    effectiveHeight: fitHeight && intrinsicSize ? intrinsicSize.height : instanceNode.height,
  };
}

export function getPreparedNodeEffectiveSize(
  node: SceneNode,
  allNodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { width: number; height: number } {
  if (node.type === "ref") {
    const prepared = prepareInstanceNode(node as RefNode, allNodes, calculateLayoutForFrame);
    if (prepared) {
      return {
        width: prepared.effectiveWidth,
        height: prepared.effectiveHeight,
      };
    }
  }

  if (node.type === "frame") {
    const prepared = prepareFrameNode(node, calculateLayoutForFrame);
    return {
      width: prepared.effectiveWidth,
      height: prepared.effectiveHeight,
    };
  }

  return { width: node.width, height: node.height };
}

export function findDescendantLocalPosition(
  children: SceneNode[],
  descendantId: string,
): { x: number; y: number } | null {
  for (const child of children) {
    if (child.id === descendantId) {
      return { x: child.x, y: child.y };
    }
    if (child.type === "frame" || child.type === "group") {
      const pos = findDescendantLocalPosition(
        (child as FrameNode | GroupNode).children,
        descendantId,
      );
      if (pos) {
        return { x: child.x + pos.x, y: child.y + pos.y };
      }
    }
  }
  return null;
}
