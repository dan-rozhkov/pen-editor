import { Container, Graphics } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  SceneNode,
  RefNode,
  DescendantOverride,
} from "@/types/scene";
import { toFlatNode } from "@/types/scene";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { measureTextAutoSize, measureTextFixedWidthHeight } from "@/utils/textMeasure";
import { getResolvedFill, parseColor, parseAlpha, pushRenderTheme, popRenderTheme } from "./colorHelpers";
import { createNodeContainer } from "./index";
import { prepareInstanceNode } from "@/components/nodes/instanceUtils";

function syncTextDimensionsInNode(node: SceneNode): SceneNode {
  if (node.type === "text") {
    const mode = node.textWidthMode;
    if (!mode || mode === "auto") {
      const measured = measureTextAutoSize(node);
      return { ...node, width: measured.width, height: measured.height };
    }
    if (mode === "fixed") {
      const measuredHeight = measureTextFixedWidthHeight(node);
      return { ...node, height: measuredHeight };
    }
    return node;
  }

  if (node.type === "frame" || node.type === "group") {
    return {
      ...node,
      children: node.children.map((child) => syncTextDimensionsInNode(child)),
    } as SceneNode;
  }

  return node;
}

export function applyOverrideRecursively(
  node: SceneNode,
  override?: DescendantOverride,
  slotContent?: Record<string, SceneNode>,
  rootOverrides?: Record<string, DescendantOverride>,
): SceneNode {
  const effectiveOverride = override ?? rootOverrides?.[node.id];
  const slotReplacement = node.type === "ref" ? slotContent?.[node.id] : undefined;
  if (slotReplacement) return syncTextDimensionsInNode(slotReplacement);

  if (!effectiveOverride) {
    if (node.type === "frame" || node.type === "group") {
      const children = node.children.map((child) =>
        applyOverrideRecursively(child, undefined, slotContent, rootOverrides),
      );
      return { ...node, children } as SceneNode;
    }
    return node;
  }

  const { descendants: nestedOverrides, ...overrideProps } = effectiveOverride;
  const merged = syncTextDimensionsInNode({ ...node, ...overrideProps } as SceneNode);

  if (merged.type === "frame" || merged.type === "group") {
    const children = merged.children.map((child) =>
      applyOverrideRecursively(
        child,
        nestedOverrides?.[child.id],
        slotContent,
        rootOverrides,
      ),
    );
    return { ...merged, children } as SceneNode;
  }

  return merged;
}

export function flattenSceneSubtree(root: SceneNode): {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
} {
  const nodesById: Record<string, FlatSceneNode> = {};
  const childrenById: Record<string, string[]> = {};

  const visit = (node: SceneNode) => {
    nodesById[node.id] = toFlatNode(node);
    if (node.type === "frame" || node.type === "group") {
      childrenById[node.id] = node.children.map((child) => child.id);
      node.children.forEach(visit);
    }
  };

  visit(root);
  return { nodesById, childrenById };
}

/**
 * Recursively label all containers in a subtree with `desc-{nodeId}` so they
 * can be looked up later (e.g., to hide descendant text during editing).
 */
function labelDescendantsInSubtree(
  container: Container,
  nodeId: string,
  childrenById: Record<string, string[]>,
): void {
  container.label = `desc-${nodeId}`;
  const childIds = childrenById[nodeId] ?? [];
  if (childIds.length === 0) return;

  const childrenHost =
    container.getChildByLabel("frame-children") ??
    container.getChildByLabel("group-children");
  if (!childrenHost) return;

  const hostContainer = childrenHost as Container;
  for (let i = 0; i < childIds.length; i++) {
    const child = hostContainer.children[i] as Container | undefined;
    if (child) {
      labelDescendantsInSubtree(child, childIds[i], childrenById);
    }
  }
}

export function createRefContainer(
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const allNodes = useSceneStore.getState().getNodes();

  // Find the component
  const component = nodesById[node.componentId];
  if (!component) {
    // Component not found - draw placeholder
    const gfx = new Graphics();
    gfx.label = "ref-placeholder";
    gfx.rect(0, 0, node.width, node.height);
    gfx.fill({ color: 0xcccccc, alpha: 0.5 });
    gfx.stroke({ color: 0x999999, width: 1 });
    container.addChild(gfx);
    return container;
  }

  // Render the component tree using the same preparation pipeline as Konva.
  const childrenContainer = new Container();
  childrenContainer.label = "ref-children";
  const prepared = prepareInstanceNode(node, allNodes, calculateLayoutForFrame);
  const renderedChildren = prepared?.layoutChildren ?? [];
  const effectiveWidth = prepared?.effectiveWidth ?? node.width;
  const effectiveHeight = prepared?.effectiveHeight ?? node.height;

  // If the component frame overrides the theme, push it for bg + children
  const compThemeOverride = component.type === "frame"
    ? (component as FlatFrameNode).themeOverride
    : undefined;
  if (compThemeOverride) {
    pushRenderTheme(compThemeOverride);
  }

  // Draw component background
  if (component.type === "frame") {
    const bg = new Graphics();
    bg.label = "ref-bg";
    const frame = component as FlatFrameNode;
    const fillColor = getResolvedFill(frame);
    if (fillColor) {
      bg.fill({ color: parseColor(fillColor), alpha: parseAlpha(fillColor) });
    }
    if (frame.cornerRadius) {
      bg.roundRect(0, 0, effectiveWidth, effectiveHeight, frame.cornerRadius);
    } else {
      bg.rect(0, 0, effectiveWidth, effectiveHeight);
    }
    bg.fill();
    childrenContainer.addChild(bg);
  }

  // Merge flattened override subtrees once to avoid O(n^2) map spreading
  // for large instances.
  const mergedNodesById: Record<string, FlatSceneNode> = { ...nodesById };
  const mergedChildrenById: Record<string, string[]> = { ...childrenById };
  const childSubtrees = renderedChildren.map((child) => ({
    child,
    flatSubtree: flattenSceneSubtree(child),
  }));
  for (const { flatSubtree } of childSubtrees) {
    Object.assign(mergedNodesById, flatSubtree.nodesById);
    Object.assign(mergedChildrenById, flatSubtree.childrenById);
  }

  for (const { child, flatSubtree } of childSubtrees) {
    if (child.enabled === false) continue;
    if (child.visible === false) continue;
    const childContainer = createNodeContainer(
      flatSubtree.nodesById[child.id],
      mergedNodesById,
      mergedChildrenById,
    );
    // Recursively label all descendant containers so they can be found for text editing visibility
    labelDescendantsInSubtree(childContainer, child.id, flatSubtree.childrenById);
    childrenContainer.addChild(childContainer);
  }

  if (compThemeOverride) {
    popRenderTheme();
  }

  container.addChild(childrenContainer);
  return container;
}

export function updateRefContainer(
  container: Container,
  node: RefNode,
  prev: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  forceRebuild = false,
): void {
  // For ref nodes, we rebuild entirely if the component, overrides, or slot content changed
  if (
    forceRebuild ||
    node.componentId !== prev.componentId ||
    node.descendants !== prev.descendants ||
    node.slotContent !== prev.slotContent ||
    node.width !== prev.width ||
    node.height !== prev.height
  ) {
    // Remove all children and rebuild
    container.removeChildren();
    const newContainer = createRefContainer(node, nodesById, childrenById);
    // Move all children from new container into existing container
    while (newContainer.children.length > 0) {
      container.addChild(newContainer.children[0]);
    }
    newContainer.destroy();
  }
}
