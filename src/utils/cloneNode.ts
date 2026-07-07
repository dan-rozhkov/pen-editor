import type {
  FrameNode,
  GroupNode,
  SceneNode,
  RefNode,
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

/** Deep clone a node tree preserving original IDs (for slot content) */
export function deepCloneNode(node: SceneNode): SceneNode {
  if (node.type === "frame") {
    return {
      ...node,
      children: node.children.map((child) => deepCloneNode(child)),
    } as FrameNode;
  }

  if (node.type === "group") {
    return {
      ...node,
      children: node.children.map((child) => deepCloneNode(child)),
    } as GroupNode;
  }

  return withClonedParagraphs({ ...node } as SceneNode);
}

export function cloneNodeWithNewId(
  node: SceneNode,
  applyOffset = true,
): SceneNode {
  const newId = generateId();
  const offset = applyOffset ? 20 : 0;

  if (node.type === "frame") {
    if (node.reusable) {
      return {
        id: newId,
        type: "ref",
        componentId: node.id,
        x: node.x + offset,
        y: node.y + offset,
        width: node.width,
        height: node.height,
        fill: node.fill,
        stroke: node.stroke,
        strokeWidth: node.strokeWidth,
        visible: node.visible,
        enabled: node.enabled,
        ...(node.fills ? { fills: node.fills } : {}),
        ...(node.effects ? { effects: node.effects } : {}),
        ...(node.shader ? { shader: node.shader } : {}),
      } as RefNode;
    }
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

  if (node.type === "ref") {
    return {
      ...node,
      id: newId,
      x: node.x + offset,
      y: node.y + offset,
    };
  }

  const cloned = {
    ...node,
    id: newId,
    x: node.x + offset,
    y: node.y + offset,
  } as SceneNode;
  return withClonedParagraphs(cloned);
}
