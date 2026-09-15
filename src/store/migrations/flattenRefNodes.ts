import { generateId } from "@/types/scene";
import type { FlatSceneNode } from "@/types/scene";

/**
 * Flat scene storage shape (matches `flattenTree`'s return / `SceneState`'s
 * primary fields), but loosely typed on `nodesById` so this migration can
 * still recognize `type: "ref"` nodes and `reusable`/`isSlot`/`properties`
 * frame fields even though none of those exist in the live `FlatSceneNode`
 * union any more.
 */
export interface FlatSceneMaps {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}

/** Document-wide node maps used to resolve a `ref`'s `componentId`. */
export interface ComponentLookup {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
}

/**
 * A node as it might appear in an OLD `.pen` document — loosely typed on
 * purpose so this migration never imports (or needs) the deleted `RefNode`/
 * component types. Only the fields the migration actually reads are named;
 * everything else passes through via the index signature.
 */
interface LegacyNode {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  componentId?: string;
  reusable?: boolean;
  isSlot?: boolean;
  properties?: unknown;
  overrides?: unknown;
  propertyValues?: unknown;
  [key: string]: unknown;
}

/** Strip legacy `reusable`/`isSlot`/`properties` keys from a (frame) node. */
function stripComponentFields(node: LegacyNode): LegacyNode {
  const { reusable: _reusable, isSlot: _isSlot, properties: _properties, ...rest } = node;
  void _reusable;
  void _isSlot;
  void _properties;
  return rest as LegacyNode;
}

/**
 * One-shot load-time migration: flattens every legacy `ref` (component
 * instance) node into a deep clone of the component frame it pointed at,
 * and strips `reusable`/`isSlot`/`properties` from every frame. Old
 * `componentArtifacts` in the document envelope simply isn't read anywhere
 * any more — nothing here needs to touch it.
 *
 * - A `ref` node is replaced, AT ITS OWN ID, by the (cleaned) component
 *   frame's content — keeping the ref's own `x`/`y`/`name`/`width`/`height`.
 *   `overrides`/`propertyValues` are intentionally dropped.
 * - The component's descendants are deep-cloned with FRESH ids (so multiple
 *   instances of the same component — and the master component itself,
 *   wherever it still lives in the document — never collide on id).
 * - Nested refs (a component instance that is itself inside another
 *   component's subtree) are resolved too, with a `visited` set guarding
 *   against a cyclic `componentId` chain.
 * - If `componentId` doesn't resolve to anything, the ref becomes an empty
 *   plain `frame` at the ref's own position/size.
 */
export function flattenRefNodes(
  flat: FlatSceneMaps,
  lookup?: ComponentLookup,
): FlatSceneMaps {
  const srcNodes = flat.nodesById as unknown as Record<string, LegacyNode>;
  const srcChildren = flat.childrenById;
  // Component masters may live on ANOTHER page of the same document (the old
  // editor injected them across pages so instances could resolve). Resolution
  // therefore reads a document-wide lookup; traversal still walks only this
  // page's own maps.
  const refNodes = (lookup?.nodesById as unknown as Record<string, LegacyNode>) ?? srcNodes;
  const refChildren = lookup?.childrenById ?? srcChildren;

  const outNodes: Record<string, LegacyNode> = {};
  const outParent: Record<string, string | null> = {};
  const outChildren: Record<string, string[]> = {};

  function setChildren(parentId: string, childIds: string[]): void {
    if (childIds.length > 0) outChildren[parentId] = childIds;
  }

  /** Build an empty plain frame at the ref's own geometry (dangling/cyclic componentId). */
  function emptyFrameFromRef(refNode: LegacyNode, outId: string, newParentId: string | null): void {
    outNodes[outId] = {
      id: outId,
      type: "frame",
      name: refNode.name,
      x: refNode.x,
      y: refNode.y,
      width: refNode.width,
      height: refNode.height,
    };
    outParent[outId] = newParentId;
  }

  /**
   * Resolve a `ref` node in place at `outId` (the ref's own id is kept for
   * the resolved root — only its NEW descendants, copied in from the
   * component, get fresh ids).
   */
  function resolveRef(
    refNode: LegacyNode,
    outId: string,
    newParentId: string | null,
    visited: Set<string>,
  ): void {
    const componentId = refNode.componentId;
    const component = componentId ? refNodes[componentId] : undefined;
    if (!component || (componentId && visited.has(componentId))) {
      emptyFrameFromRef(refNode, outId, newParentId);
      return;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(componentId as string);

    const cleaned = stripComponentFields(component);
    outNodes[outId] = {
      ...cleaned,
      id: outId,
      name: refNode.name,
      x: refNode.x,
      y: refNode.y,
      width: refNode.width,
      height: refNode.height,
    };
    outParent[outId] = newParentId;

    const kids = refChildren[componentId as string];
    if (kids) {
      setChildren(
        outId,
        kids.map((childId) => cloneFresh(childId, outId, nextVisited)),
      );
    }
  }

  /**
   * Deep-clone a node (and its subtree) from the ORIGINAL graph under a
   * brand-new id — used for every descendant copied in from a component's
   * subtree when resolving a ref.
   */
  function cloneFresh(origId: string, newParentId: string, visited: Set<string>): string {
    const node = refNodes[origId];
    const newId = generateId();
    if (!node) {
      outNodes[newId] = { id: newId, type: "frame", x: 0, y: 0, width: 0, height: 0 };
      outParent[newId] = newParentId;
      return newId;
    }
    if (node.type === "ref") {
      resolveRef(node, newId, newParentId, visited);
      return newId;
    }
    const cleaned = stripComponentFields(node);
    outNodes[newId] = { ...cleaned, id: newId };
    outParent[newId] = newParentId;
    const kids = refChildren[origId];
    if (kids) {
      setChildren(
        newId,
        kids.map((childId) => cloneFresh(childId, newId, visited)),
      );
    }
    return newId;
  }

  /**
   * Walk a node reached via the document's own (non-cloned) tree, keeping
   * its original id — except a `ref` node, which is resolved in place (see
   * `resolveRef`). `visiting` guards against a corrupt cyclic parent/child
   * graph recursing forever (mirrors `buildTree`'s guard in `types/scene.ts`).
   */
  function walkNormal(origId: string, newParentId: string | null, visiting: Set<string>): void {
    const node = srcNodes[origId];
    if (!node) return;

    if (node.type === "ref") {
      resolveRef(node, origId, newParentId, new Set());
      return;
    }

    const cleaned = stripComponentFields(node);
    outNodes[origId] = { ...cleaned, id: origId };
    outParent[origId] = newParentId;

    if (visiting.has(origId)) return;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(origId);

    const kids = srcChildren[origId];
    if (kids) {
      setChildren(origId, kids.slice());
      for (const childId of kids) {
        walkNormal(childId, origId, nextVisiting);
      }
    }
  }

  for (const rootId of flat.rootIds) {
    walkNormal(rootId, null, new Set());
  }

  return {
    nodesById: outNodes as unknown as Record<string, FlatSceneNode>,
    parentById: outParent,
    childrenById: outChildren,
    rootIds: [...flat.rootIds],
  };
}

/**
 * Document-level entry point: migrate EVERY page of an opened document in one
 * go, resolving each `ref` against a lookup merged from all pages so an
 * instance whose component master lives on another page still resolves (the
 * editor used to inject cross-page component subtrees for exactly this).
 *
 * A page's own nodes win on id collision, so a page is never rewritten from a
 * same-id node belonging to a different page.
 */
export function flattenRefNodesAcrossPages(pages: FlatSceneMaps[]): FlatSceneMaps[] {
  if (pages.length === 0) return pages;

  const mergedNodes: Record<string, FlatSceneNode> = {};
  const mergedChildren: Record<string, string[]> = {};
  for (const page of pages) {
    Object.assign(mergedNodes, page.nodesById);
    Object.assign(mergedChildren, page.childrenById);
  }

  return pages.map((page) =>
    flattenRefNodes(page, {
      nodesById: { ...mergedNodes, ...page.nodesById },
      childrenById: { ...mergedChildren, ...page.childrenById },
    }),
  );
}
