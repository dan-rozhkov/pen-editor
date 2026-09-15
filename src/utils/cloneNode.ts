import type {
  FrameNode,
  GroupNode,
  SceneNode,
  TextNode,
} from "@/types/scene";
import { generateId } from "@/types/scene";

/**
 * A shallow `{...node}` spread copies the object but not its array-typed
 * fields, so a cloned text node would still share its `paragraphs` array
 * reference with the original — mutating one (e.g. via the inline editor)
 * would silently mutate the other. Copy the array so clones are independent.
 */
function withClonedParagraphs<T extends SceneNode>(clone: T): T {
  if (clone.type === "text" && (clone as TextNode).paragraphs) {
    return { ...clone, paragraphs: [...(clone as TextNode).paragraphs!] };
  }
  return clone;
}

export function cloneNodeWithNewId(
  node: SceneNode,
  applyOffset = true,
): SceneNode {
  const newId = generateId();
  const offset = applyOffset ? 20 : 0;

  if (node.type === "frame") {
    return {
      ...node,
      id: newId,
      x: node.x + offset,
      y: node.y + offset,
      children: node.children.map((child) => cloneNodeWithNewId(child, false)),
    } as FrameNode;
  }

  if (node.type === "group") {
    return {
      ...node,
      id: newId,
      x: node.x + offset,
      y: node.y + offset,
      children: (node as GroupNode).children.map((child) =>
        cloneNodeWithNewId(child, false),
      ),
    } as GroupNode;
  }

  const cloned = {
    ...node,
    id: newId,
    x: node.x + offset,
    y: node.y + offset,
  } as SceneNode;
  return withClonedParagraphs(cloned);
}
