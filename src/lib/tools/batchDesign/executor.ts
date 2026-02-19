import type {
  FlatSceneNode,
  SceneNode,
  RefNode,
  DescendantOverrides,
  FlatFrameNode,
} from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import {
  toFlatNode,
  isContainerNode,
  buildTree,
} from "@/types/scene";
import { useThemeStore } from "@/store/themeStore";
import { insertTreeIntoFlat, removeNodeAndDescendants } from "@/store/sceneStore/helpers/flatStoreHelpers";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import { setOverrideByPath } from "@/utils/instanceUtils";
import type { ParsedArg, ParsedOperation, ExecutionContext } from "./types";
import {
  createNodeFromAiDataWithTheme,
  mapNodeData,
  mapDescendantOverride,
} from "./nodeMapper";
import { serializeNodeToDepth } from "../serializeUtils";

const DOCUMENT_BINDING = "__document__";

/** Strip slash-separated paths to get the root parent ID. */
function resolveActualParentId(parentResolved: string | null): string | null {
  if (parentResolved && parentResolved.includes("/")) {
    return parentResolved.split("/")[0];
  }
  return parentResolved;
}

function resolveInheritedTheme(
  parentId: string | null,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
): ThemeName {
  const { activeTheme } = useThemeStore.getState();
  let theme: ThemeName = activeTheme;
  let current = parentId;

  const chain: string[] = [];
  while (current) {
    chain.push(current);
    current = parentById[current] ?? null;
  }

  for (let i = chain.length - 1; i >= 0; i--) {
    const node = nodesById[chain[i]];
    if (node?.type === "frame" && (node as FlatFrameNode).themeOverride) {
      theme = (node as FlatFrameNode).themeOverride as ThemeName;
    }
  }

  return theme;
}

function applyRefDefaultsFromComponent(
  node: SceneNode,
  nodeData: Record<string, unknown>,
  nodesById: Record<string, FlatSceneNode>,
): SceneNode {
  if (node.type !== "ref") return node;

  const refNode = node as RefNode;
  const component = nodesById[refNode.componentId];
  if (!component || component.type !== "frame") return node;

  const hasWidth = Object.prototype.hasOwnProperty.call(nodeData, "width");
  const hasHeight = Object.prototype.hasOwnProperty.call(nodeData, "height");
  const hasSizing = Object.prototype.hasOwnProperty.call(nodeData, "sizing");

  return {
    ...refNode,
    width: hasWidth ? refNode.width : component.width,
    height: hasHeight ? refNode.height : component.height,
    sizing: hasSizing ? refNode.sizing : component.sizing,
  } as SceneNode;
}

/**
 * Resolve a ParsedArg to its string value using the execution context bindings.
 */
function resolveArg(arg: ParsedArg, ctx: ExecutionContext): string {
  switch (arg.kind) {
    case "string":
      return arg.value;
    case "binding": {
      const resolved = ctx.bindings.get(arg.name);
      if (resolved === undefined) {
        throw new Error(`Unresolved binding: "${arg.name}"`);
      }
      return resolved;
    }
    case "concat": {
      const base = ctx.bindings.get(arg.bindingName);
      if (base === undefined) {
        throw new Error(`Unresolved binding: "${arg.bindingName}"`);
      }
      return base + arg.pathSuffix;
    }
    case "number":
      return String(arg.value);
    case "json":
      throw new Error("Cannot resolve JSON arg as string");
  }
}

/**
 * Resolve a ParsedArg that could be a JSON object.
 */
function resolveJsonArg(arg: ParsedArg): Record<string, unknown> {
  if (
    arg.kind === "json" &&
    arg.value !== null &&
    typeof arg.value === "object" &&
    !Array.isArray(arg.value)
  ) {
    return arg.value as Record<string, unknown>;
  }
  throw new Error(`Expected JSON argument, got ${arg.kind}`);
}

/**
 * Resolve a parent argument. Returns the parent node ID, or null for document root.
 */
function resolveParent(
  arg: ParsedArg,
  ctx: ExecutionContext
): string | null {
  const resolved = resolveArg(arg, ctx);
  if (resolved === DOCUMENT_BINDING) return null;

  // Verify parent exists (could be a path like "instanceId/slotId")
  const baseId = resolved.includes("/") ? resolved.split("/")[0] : resolved;
  if (!ctx.nodesById[baseId]) {
    throw new Error(`Parent node not found: "${resolved}"`);
  }
  return resolved;
}

/**
 * Execute a single Insert operation.
 * I(parent, nodeData)
 */
function executeInsert(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: I() requires at least 2 arguments (parent, nodeData)`);
  }

  const parentResolved = resolveParent(op.args[0], ctx);
  const nodeData = resolveJsonArg(op.args[1]);

  // Handle parent paths with "/" for slot insertion
  const actualParentId = resolveActualParentId(parentResolved);

  const inheritedTheme = resolveInheritedTheme(
    actualParentId,
    ctx.nodesById,
    ctx.parentById,
  );
  const createdNode = createNodeFromAiDataWithTheme(nodeData, inheritedTheme);
  const node = applyRefDefaultsFromComponent(createdNode, nodeData, ctx.nodesById);

  // Insert into flat storage
  insertTreeIntoFlat(
    node,
    actualParentId,
    ctx.nodesById,
    ctx.parentById,
    ctx.childrenById
  );

  // Update parent's children list or rootIds
  if (actualParentId === null) {
    ctx.rootIds.push(node.id);
  } else {
    if (!ctx.childrenById[actualParentId]) {
      ctx.childrenById[actualParentId] = [];
    }
    ctx.childrenById[actualParentId].push(node.id);
  }

  ctx.createdNodeIds.push(node.id);

  // Save binding
  if (op.binding) {
    ctx.bindings.set(op.binding, node.id);
  }
}

/**
 * Execute a Copy operation.
 * C(sourceId, parent, copyData?)
 */
function executeCopy(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: C() requires at least 2 arguments (sourceId, parent)`);
  }

  const sourceId = resolveArg(op.args[0], ctx);
  const parentResolved = resolveParent(op.args[1], ctx);
  const copyData = op.args.length >= 3 ? resolveJsonArg(op.args[2]) : {};

  // Resolve actual parent (strip "/" paths)
  const actualParentId = resolveActualParentId(parentResolved);

  // Build source subtree
  const sourceNode = ctx.nodesById[sourceId];
  if (!sourceNode) {
    throw new Error(`Line ${op.line}: Source node not found: "${sourceId}"`);
  }

  const sourceTree = buildTree(
    [sourceId],
    ctx.nodesById,
    ctx.childrenById
  )[0];

  // Clone with new IDs
  const cloned = cloneNodeWithNewId(sourceTree, false);

  // Apply copyData overrides (name, width, height, fill, etc.)
  const {
    descendants: descendantsOverrides,
    positionDirection,
    positionPadding,
    ...directOverrides
  } = copyData;

  // Map direct overrides through nodeMapper
  if (Object.keys(directOverrides).length > 0) {
    const inheritedTheme = resolveInheritedTheme(
      actualParentId,
      ctx.nodesById,
      ctx.parentById,
    );
    const mapped = mapNodeData(
      directOverrides as Record<string, unknown>,
      "update",
      toFlatNode(cloned),
      { theme: inheritedTheme },
    );
    delete (mapped as Record<string, unknown>)._children;
    Object.assign(cloned, mapped);
  }

  // Handle descendants overrides for ref nodes
  if (descendantsOverrides && cloned.type === "ref") {
    const refClone = cloned as RefNode;
    const mappedOverrides: DescendantOverrides = {};
    for (const [path, override] of Object.entries(
      descendantsOverrides as Record<string, Record<string, unknown>>
    )) {
      mappedOverrides[path] = mapDescendantOverride(override, {
        theme: resolveInheritedTheme(actualParentId, ctx.nodesById, ctx.parentById),
      });
    }
    refClone.descendants = {
      ...refClone.descendants,
      ...mappedOverrides,
    };
  }

  // Handle descendants overrides for non-ref clones by building old→new ID map
  if (descendantsOverrides && cloned.type !== "ref") {
    const oldToNew = buildIdMap(sourceTree, cloned);
    for (const [oldPath, override] of Object.entries(
      descendantsOverrides as Record<string, Record<string, unknown>>
    )) {
      // Remap the path from old IDs to new IDs
      const newPath = remapPath(oldPath, oldToNew);
      const newNode = ctx.nodesById[newPath];
      if (newNode) {
        const mapped = mapNodeData(
          override as Record<string, unknown>,
          "update",
          newNode,
          {
            theme: resolveInheritedTheme(
              ctx.parentById[newPath] ?? null,
              ctx.nodesById,
              ctx.parentById,
            ),
          },
        );
        delete (mapped as Record<string, unknown>)._children;
        Object.assign(newNode, mapped);
      }
    }
  }

  // Handle positioning
  if (positionDirection || positionPadding) {
    const pad = (positionPadding as number) ?? 50;
    const dir = (positionDirection as string) ?? "right";
    switch (dir) {
      case "right":
        cloned.x = sourceNode.x + sourceNode.width + pad;
        cloned.y = sourceNode.y;
        break;
      case "left":
        cloned.x = sourceNode.x - cloned.width - pad;
        cloned.y = sourceNode.y;
        break;
      case "bottom":
        cloned.x = sourceNode.x;
        cloned.y = sourceNode.y + sourceNode.height + pad;
        break;
      case "top":
        cloned.x = sourceNode.x;
        cloned.y = sourceNode.y - cloned.height - pad;
        break;
    }
  }

  // Insert cloned tree into flat storage
  insertTreeIntoFlat(
    cloned,
    actualParentId,
    ctx.nodesById,
    ctx.parentById,
    ctx.childrenById
  );

  if (actualParentId === null) {
    ctx.rootIds.push(cloned.id);
  } else {
    if (!ctx.childrenById[actualParentId]) {
      ctx.childrenById[actualParentId] = [];
    }
    ctx.childrenById[actualParentId].push(cloned.id);
  }

  ctx.createdNodeIds.push(cloned.id);

  if (op.binding) {
    ctx.bindings.set(op.binding, cloned.id);
  }
}

/**
 * Build a map from old IDs to new IDs by walking source and clone trees in parallel.
 */
function buildIdMap(
  source: SceneNode,
  clone: SceneNode
): Map<string, string> {
  const map = new Map<string, string>();
  map.set(source.id, clone.id);

  if (isContainerNode(source) && isContainerNode(clone)) {
    const srcChildren = source.children;
    const clnChildren = clone.children;
    for (let i = 0; i < srcChildren.length && i < clnChildren.length; i++) {
      const childMap = buildIdMap(srcChildren[i], clnChildren[i]);
      for (const [k, v] of childMap) map.set(k, v);
    }
  }

  return map;
}

/**
 * Remap a "/" separated path from old IDs to new IDs.
 */
function remapPath(path: string, idMap: Map<string, string>): string {
  return path
    .split("/")
    .map((segment) => idMap.get(segment) ?? segment)
    .join("/");
}

function setDescendantOverrideByPath(
  existingOverrides: DescendantOverrides | undefined,
  descendantPath: string,
  mappedOverride: Record<string, unknown>,
): DescendantOverrides {
  const segments = descendantPath.split("/").filter(Boolean);
  return setOverrideByPath(existingOverrides ?? {}, segments, mappedOverride);
}

/**
 * Execute an Update operation.
 * U(path, updateData)
 */
/** Parse a slash-separated instance path, validate, and return the ref node clone + metadata. */
function resolveInstancePath(
  path: string,
  op: ParsedOperation,
  ctx: ExecutionContext,
): { instanceId: string; subPath: string; refNode: RefNode; theme: ThemeName } {
  const slashIdx = path.indexOf("/");
  const instanceId = path.slice(0, slashIdx);
  const subPath = path.slice(slashIdx + 1);

  const instanceNode = ctx.nodesById[instanceId];
  if (!instanceNode) {
    throw new Error(
      `Line ${op.line}: Instance node not found: "${instanceId}"`
    );
  }
  if (instanceNode.type !== "ref") {
    throw new Error(
      `Line ${op.line}: Node "${instanceId}" is not a ref node (type: ${instanceNode.type})`
    );
  }

  return {
    instanceId,
    subPath,
    refNode: { ...instanceNode } as RefNode,
    theme: resolveInheritedTheme(
      ctx.parentById[instanceId] ?? null,
      ctx.nodesById,
      ctx.parentById,
    ),
  };
}

function executeUpdate(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: U() requires 2 arguments (path, updateData)`);
  }

  const path = resolveArg(op.args[0], ctx);
  const updateData = resolveJsonArg(op.args[1]);

  if (path.includes("/")) {
    const { instanceId, subPath, refNode, theme } = resolveInstancePath(path, op, ctx);
    const mapped = mapDescendantOverride(updateData, { theme });

    refNode.descendants = setDescendantOverrideByPath(
      refNode.descendants,
      subPath,
      mapped,
    );

    ctx.nodesById[instanceId] = refNode;
  } else {
    // Direct node update
    const node = ctx.nodesById[path];
    if (!node) {
      throw new Error(`Line ${op.line}: Node not found: "${path}"`);
    }

    const mapped = mapNodeData(updateData, "update", node, {
      theme: resolveInheritedTheme(
        ctx.parentById[path] ?? null,
        ctx.nodesById,
        ctx.parentById,
      ),
    });
    delete (mapped as Record<string, unknown>)._children;

    let updated = { ...node, ...mapped } as FlatSceneNode;

    // Sync text dimensions if text node
    if (updated.type === "text") {
      updated = syncTextDimensions(updated);
    }

    ctx.nodesById[path] = updated;
  }
}

/**
 * Execute a Replace operation.
 * R(path, nodeData)
 */
function executeReplace(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: R() requires 2 arguments (path, nodeData)`);
  }

  const path = resolveArg(op.args[0], ctx);
  const nodeData = resolveJsonArg(op.args[1]);

  if (path.includes("/")) {
    const { instanceId, subPath: slotChildId, refNode, theme } = resolveInstancePath(path, op, ctx);
    const newNode = createNodeFromAiDataWithTheme(nodeData, theme);
    refNode.slotContent = {
      ...refNode.slotContent,
      [slotChildId]: newNode,
    };

    ctx.nodesById[instanceId] = refNode;
    ctx.createdNodeIds.push(newNode.id);

    if (op.binding) {
      ctx.bindings.set(op.binding, newNode.id);
    }
  } else {
    // Direct node replacement
    const existingNode = ctx.nodesById[path];
    if (!existingNode) {
      throw new Error(`Line ${op.line}: Node not found: "${path}"`);
    }

    const parentId = ctx.parentById[path];
    const newNode = createNodeFromAiDataWithTheme(
      nodeData,
      resolveInheritedTheme(parentId ?? null, ctx.nodesById, ctx.parentById),
    );

    // Find position in parent's children
    if (parentId !== null && parentId !== undefined) {
      const siblings = ctx.childrenById[parentId] ?? [];
      const idx = siblings.indexOf(path);
      if (idx !== -1) {
        siblings[idx] = newNode.id;
        ctx.childrenById[parentId] = [...siblings];
      }
    } else {
      const idx = ctx.rootIds.indexOf(path);
      if (idx !== -1) {
        ctx.rootIds[idx] = newNode.id;
      }
    }

    // Remove old node and descendants
    removeNodeAndDescendants(
      path,
      ctx.nodesById,
      ctx.parentById,
      ctx.childrenById
    );

    // Insert new node
    insertTreeIntoFlat(
      newNode,
      parentId ?? null,
      ctx.nodesById,
      ctx.parentById,
      ctx.childrenById
    );

    ctx.createdNodeIds.push(newNode.id);

    if (op.binding) {
      ctx.bindings.set(op.binding, newNode.id);
    }
  }
}

/**
 * Execute a Move operation.
 * M(nodeId, parent, index?)
 */
function executeMove(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: M() requires at least 2 arguments (nodeId, parent)`);
  }

  const nodeId = resolveArg(op.args[0], ctx);
  const parentResolved = op.args[1].kind === "json" && op.args[1].value === undefined
    ? null
    : resolveArg(op.args[1], ctx);
  const newParentId =
    parentResolved === DOCUMENT_BINDING ? null : parentResolved;
  const newIndex =
    op.args.length >= 3
      ? op.args[2].kind === "number"
        ? op.args[2].value
        : Number(resolveArg(op.args[2], ctx))
      : undefined;

  const node = ctx.nodesById[nodeId];
  if (!node) {
    throw new Error(`Line ${op.line}: Node not found: "${nodeId}"`);
  }

  const oldParentId = ctx.parentById[nodeId];

  // Remove from old parent
  if (oldParentId !== null && oldParentId !== undefined) {
    ctx.childrenById[oldParentId] = (
      ctx.childrenById[oldParentId] ?? []
    ).filter((cid) => cid !== nodeId);
  } else {
    ctx.rootIds = ctx.rootIds.filter((rid) => rid !== nodeId);
  }

  // Set new parent
  ctx.parentById[nodeId] = newParentId;

  // Insert at new position
  if (newParentId !== null) {
    const siblings = ctx.childrenById[newParentId] ?? [];
    const idx = newIndex !== undefined ? newIndex : siblings.length;
    siblings.splice(idx, 0, nodeId);
    ctx.childrenById[newParentId] = siblings;
  } else {
    const idx = newIndex !== undefined ? newIndex : ctx.rootIds.length;
    ctx.rootIds.splice(idx, 0, nodeId);
  }
}

/**
 * Execute a Delete operation.
 * D(nodeId)
 */
function executeDelete(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 1) {
    throw new Error(`Line ${op.line}: D() requires 1 argument (nodeId)`);
  }

  const nodeId = resolveArg(op.args[0], ctx);

  if (!ctx.nodesById[nodeId]) {
    throw new Error(`Line ${op.line}: Node not found: "${nodeId}"`);
  }

  const parentId = ctx.parentById[nodeId];

  // Remove from parent's children list
  if (parentId !== null && parentId !== undefined) {
    ctx.childrenById[parentId] = (
      ctx.childrenById[parentId] ?? []
    ).filter((cid) => cid !== nodeId);
  } else {
    ctx.rootIds = ctx.rootIds.filter((rid) => rid !== nodeId);
  }

  // Remove node and all descendants
  removeNodeAndDescendants(
    nodeId,
    ctx.nodesById,
    ctx.parentById,
    ctx.childrenById
  );
}

/**
 * Execute a Generate Image operation (stub).
 * G(nodeId, type, prompt)
 */
function executeGenerate(
  op: ParsedOperation,
  ctx: ExecutionContext
): void {
  if (op.args.length < 3) {
    throw new Error(
      `Line ${op.line}: G() requires 3 arguments (nodeId, type, prompt)`
    );
  }

  const nodeId = resolveArg(op.args[0], ctx);
  resolveArg(op.args[1], ctx); // "ai" or "stock" — consumed but unused in stub
  const prompt = resolveArg(op.args[2], ctx);

  const node = ctx.nodesById[nodeId];
  if (!node) {
    throw new Error(`Line ${op.line}: Node not found: "${nodeId}"`);
  }

  // Stub: apply placeholder image fill
  ctx.nodesById[nodeId] = {
    ...node,
    imageFill: {
      url: `https://placehold.co/600x400?text=${encodeURIComponent(prompt.slice(0, 30))}`,
      mode: "fill",
    },
    name: node.name ?? `Image: ${prompt.slice(0, 50)}`,
  } as FlatSceneNode;

  ctx.issues.push(
    `G operation on line ${op.line}: Image generation is a placeholder. Prompt: "${prompt}"`
  );
}

/**
 * Execute a single parsed operation against the execution context.
 */
export function executeOperation(
  op: ParsedOperation,
  ctx: ExecutionContext
): void {
  switch (op.op) {
    case "I":
      return executeInsert(op, ctx);
    case "C":
      return executeCopy(op, ctx);
    case "U":
      return executeUpdate(op, ctx);
    case "R":
      return executeReplace(op, ctx);
    case "M":
      return executeMove(op, ctx);
    case "D":
      return executeDelete(op, ctx);
    case "G":
      return executeGenerate(op, ctx);
    default:
      throw new Error(`Line ${op.line}: Unknown operation: ${op.op}`);
  }
}

/**
 * Serialize created nodes for the response (depth 2).
 */
export function serializeCreatedNodes(
  ctx: ExecutionContext
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const nodeId of ctx.createdNodeIds) {
    if (seen.has(nodeId) || !ctx.nodesById[nodeId]) continue;
    seen.add(nodeId);
    results.push(
      serializeNodeWithDepth(nodeId, ctx, 2)
    );
  }

  return results;
}

function serializeNodeWithDepth(
  nodeId: string,
  ctx: ExecutionContext,
  depth: number
): Record<string, unknown> {
  return serializeNodeToDepth(nodeId, ctx.nodesById, ctx.childrenById, depth)
    ?? { id: nodeId, error: "not found" };
}
