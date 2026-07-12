import { Container } from "pixi.js";
import type { FlatSceneNode, FlatGroupNode } from "@/types/scene";
import { createNodeContainer } from "./index";
import { applySiblingMasks } from "./maskHelpers";
import { isOutlineRenderMode } from "./outlineHelpers";

export function createGroupContainer(
  node: FlatGroupNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();

  // Children container
  const childrenContainer = new Container();
  childrenContainer.label = "group-children";
  container.addChild(childrenContainer);

  // Render children
  const childIds = childrenById[node.id] ?? [];
  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (childNode) {
      const childContainer = createNodeContainer(
        childNode,
        nodesById,
        childrenById,
      );
      childrenContainer.addChild(childContainer);
    }
  }

  // Figma-style sibling masking (a node with isMask clips siblings above
  // it) — skipped in outline mode, which never applies masks.
  if (!isOutlineRenderMode()) {
    applySiblingMasks(
      childIds,
      nodesById,
      (id) => childrenContainer.getChildByLabel(id),
      childrenContainer,
    );
  }

  return container;
}
