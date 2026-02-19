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
import { pushRenderTheme, popRenderTheme } from "./colorHelpers";
import { applyFill, applyStroke } from "./fillStrokeHelpers";
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

function cloneSceneTreeWithRenderIds(
  node: SceneNode,
  path: string,
): SceneNode {
  const renderId = `${path}/${node.id}`;
  if (node.type === "frame" || node.type === "group") {
    return {
      ...node,
      id: renderId,
      children: node.children.map((child, index) =>
        cloneSceneTreeWithRenderIds(child, `${renderId}:${index}`),
      ),
    } as SceneNode;
  }
  return { ...node, id: renderId } as SceneNode;
}

/**
 * Recursively label all containers in a subtree with `desc-{nodeId}` so they
 * can be looked up later (e.g., to hide descendant text during editing).
 */
function labelDescendantsFromSourceTree(
  container: Container,
  sourceNode: SceneNode,
): void {
  container.label = `desc-${sourceNode.id}`;
  if (sourceNode.type !== "frame" && sourceNode.type !== "group") return;
  if (sourceNode.children.length === 0) return;

  const childrenHost =
    container.getChildByLabel("frame-children") ??
    container.getChildByLabel("group-children");
  if (!childrenHost) return;

  const hostContainer = childrenHost as Container;
  for (let i = 0; i < sourceNode.children.length; i++) {
    const child = hostContainer.children[i] as Container | undefined;
    if (child) {
      labelDescendantsFromSourceTree(child, sourceNode.children[i]);
    }
  }
}

export function createRefContainer(
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  _childrenById: Record<string, string[]>,
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
  try {
    // Draw component background
    if (component.type === "frame") {
      const bg = new Graphics();
      bg.label = "ref-bg";
      const frame = component as FlatFrameNode;
      const effectiveFrameStyle: FlatFrameNode = {
        ...frame,
        fill: node.fill !== undefined ? node.fill : frame.fill,
        fillBinding: node.fillBinding !== undefined ? node.fillBinding : frame.fillBinding,
        fillOpacity: node.fillOpacity !== undefined ? node.fillOpacity : frame.fillOpacity,
        gradientFill:
          node.gradientFill !== undefined ? node.gradientFill : frame.gradientFill,
        stroke: node.stroke !== undefined ? node.stroke : frame.stroke,
        strokeBinding:
          node.strokeBinding !== undefined ? node.strokeBinding : frame.strokeBinding,
        strokeWidth: node.strokeWidth !== undefined ? node.strokeWidth : frame.strokeWidth,
        strokeOpacity:
          node.strokeOpacity !== undefined ? node.strokeOpacity : frame.strokeOpacity,
        strokeAlign:
          node.strokeAlign !== undefined ? node.strokeAlign : frame.strokeAlign,
        strokeWidthPerSide:
          node.strokeWidthPerSide !== undefined
            ? node.strokeWidthPerSide
            : frame.strokeWidthPerSide,
      };
      if (frame.cornerRadius) {
        bg.roundRect(0, 0, effectiveWidth, effectiveHeight, frame.cornerRadius);
      } else {
        bg.rect(0, 0, effectiveWidth, effectiveHeight);
      }
      applyFill(bg, effectiveFrameStyle, effectiveWidth, effectiveHeight);
      applyStroke(bg, effectiveFrameStyle, effectiveWidth, effectiveHeight, frame.cornerRadius);
      childrenContainer.addChild(bg);

      // In auto-layout siblings, outside stroke should not visually bleed
      // into neighbors. Clip only the instance background to its own bounds.
      const parentId = useSceneStore.getState().parentById[node.id];
      const parentNode = parentId ? nodesById[parentId] : undefined;
      const isInAutoLayoutParent =
        parentNode?.type === "frame" &&
        (parentNode as FlatFrameNode).layout?.autoLayout;
      const effectiveStrokeAlign = effectiveFrameStyle.strokeAlign ?? "center";
      if (isInAutoLayoutParent && effectiveStrokeAlign === "outside") {
        const bgMask = new Graphics();
        bgMask.label = "ref-bg-mask";
        if (frame.cornerRadius) {
          bgMask.roundRect(0, 0, effectiveWidth, effectiveHeight, frame.cornerRadius);
        } else {
          bgMask.rect(0, 0, effectiveWidth, effectiveHeight);
        }
        bgMask.fill(0xffffff);
        childrenContainer.addChild(bgMask);
        bg.mask = bgMask;
      }
    }

    for (let childIndex = 0; childIndex < renderedChildren.length; childIndex++) {
      const child = renderedChildren[childIndex];
      if (child.enabled === false) continue;
      if (child.visible === false) continue;

      // Render instance descendants from an isolated flat map with unique IDs.
      // This avoids key collisions when the same component is instantiated
      // multiple times inside one instance (their inner node IDs are identical).
      const renderTree = cloneSceneTreeWithRenderIds(
        child,
        `ref-${node.id}:${childIndex}`,
      );
      const flatSubtree = flattenSceneSubtree(renderTree);
      const childContainer = createNodeContainer(
        flatSubtree.nodesById[renderTree.id],
        flatSubtree.nodesById,
        flatSubtree.childrenById,
      );
      // Re-apply labels from the original (non-render-cloned) tree so
      // interaction still targets source descendant IDs.
      labelDescendantsFromSourceTree(childContainer, child);
      childrenContainer.addChild(childContainer);
    }
  } finally {
    if (compThemeOverride) {
      popRenderTheme();
    }
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
    node.sizing !== prev.sizing ||
    node.descendants !== prev.descendants ||
    node.slotContent !== prev.slotContent ||
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.fillOpacity !== prev.fillOpacity ||
    node.gradientFill !== prev.gradientFill ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeOpacity !== prev.strokeOpacity ||
    node.strokeWidth !== prev.strokeWidth ||
    node.strokeAlign !== prev.strokeAlign ||
    node.strokeWidthPerSide !== prev.strokeWidthPerSide ||
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
