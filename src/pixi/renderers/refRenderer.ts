import { Container, Graphics } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  FrameNode,
  SceneNode,
  RefNode,
  DescendantOverride,
} from "@/types/scene";
import { toFlatNode } from "@/types/scene";
import { useLayoutStore } from "@/store/layoutStore";
import { applyAutoLayoutRecursively } from "@/utils/autoLayoutUtils";
import { getResolvedFill, parseColor, parseAlpha } from "./colorHelpers";
import { flatToTreeFrame } from "./frameRenderer";
import { createNodeContainer } from "./index";

export function applyOverrideRecursively(
  node: SceneNode,
  override?: DescendantOverride,
  slotContent?: Record<string, SceneNode>,
  rootOverrides?: Record<string, DescendantOverride>,
): SceneNode {
  const effectiveOverride = override ?? rootOverrides?.[node.id];
  const slotReplacement = node.type === "ref" ? slotContent?.[node.id] : undefined;
  if (slotReplacement) return slotReplacement;

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
  const merged = { ...node, ...overrideProps } as SceneNode;

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

export function createRefContainer(
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

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

  // Render the component tree with overrides
  const childrenContainer = new Container();
  childrenContainer.label = "ref-children";

  const componentTree = component.type === "frame"
    ? flatToTreeFrame(component as FlatFrameNode, nodesById, childrenById)
    : null;
  const preparedComponent = componentTree
    ? (applyAutoLayoutRecursively(componentTree, calculateLayoutForFrame) as FrameNode)
    : null;
  const renderedChildren = preparedComponent?.children ?? [];

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
      bg.roundRect(0, 0, node.width, node.height, frame.cornerRadius);
    } else {
      bg.rect(0, 0, node.width, node.height);
    }
    bg.fill();
    childrenContainer.addChild(bg);
  }

  for (const child of renderedChildren) {
    const childOverride = node.descendants?.[child.id];
    if (childOverride?.enabled === false) continue;
    const overriddenChild = applyOverrideRecursively(
      child,
      childOverride,
      node.slotContent,
      node.descendants,
    );
    const laidOutChild = applyAutoLayoutRecursively(
      overriddenChild,
      calculateLayoutForFrame,
    );
    const flatSubtree = flattenSceneSubtree(laidOutChild);
    // Merge global store so nested ref nodes can find their components
    const childContainer = createNodeContainer(
      flatSubtree.nodesById[laidOutChild.id],
      { ...nodesById, ...flatSubtree.nodesById },
      { ...childrenById, ...flatSubtree.childrenById },
    );
    childrenContainer.addChild(childContainer);
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
): void {
  // For ref nodes, we rebuild entirely if the component, overrides, or slot content changed
  if (
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
