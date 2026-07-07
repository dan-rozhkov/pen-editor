import type {
  FlatSceneNode,
  SceneNode,
  FlatFrameNode,
  EmbedNode,
  ImageFill,
  Paint,
  RefNode,
} from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import {
  toFlatNode,
  isContainerNode,
  buildTree,
  collectDescendantIds,
} from "@/types/scene";
import {
  insertTreeIntoFlat,
  removeNodeAndDescendants,
  removeOrphanedConnectors,
  repointConnectors,
} from "@/store/sceneStore/helpers/flatStoreHelpers";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import {
  clearLegacyFillProps,
  createImagePaint,
  createSolidPaint,
  getFills,
} from "@/utils/fillUtils";
import { normalizeEmbedHtmlForStorage } from "@/utils/embedTemplateUtils";
import { getPropertyValuesUpdateError } from "@/utils/componentProperties";
import type { ParsedArg, ParsedOperation, ExecutionContext } from "./types";
import {
  createNodeFromAiDataWithTheme,
  mapNodeData,
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
  let theme: ThemeName = 'light';
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

/**
 * If the node is an embed, expand any document component tags in its htmlContent
 * and set sourceTemplate accordingly.
 */
function normalizeEmbedNode(
  node: SceneNode | FlatSceneNode,
  ctx: ExecutionContext,
): void {
  if (node.type !== "embed" || ctx.componentTagMap.size === 0) return;
  const embed = node as EmbedNode;
  const { htmlContent, sourceTemplate, issues } = normalizeEmbedHtmlForStorage(
    embed.htmlContent,
    ctx.componentTagMap,
  );
  embed.htmlContent = htmlContent;
  if (sourceTemplate) {
    embed.sourceTemplate = sourceTemplate;
  }
  for (const issue of issues) {
    ctx.issues.push(issue);
  }
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
      if (resolved !== undefined) {
        return resolved;
      }

      // Be permissive for existing node IDs from previous calls:
      // agents often pass raw IDs without quotes (e.g. U(abc123, {...})).
      if (ctx.nodesById[arg.name]) {
        return arg.name;
      }

      throw new Error(`Unresolved binding: "${arg.name}"`);
    }
    case "concat": {
      const base = ctx.bindings.get(arg.bindingName);
      if (base !== undefined) {
        return base + arg.pathSuffix;
      }

      // Same permissive fallback for raw node IDs.
      if (ctx.nodesById[arg.bindingName]) {
        return arg.bindingName + arg.pathSuffix;
      }

      throw new Error(`Unresolved binding: "${arg.bindingName}"`);
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
  const node = createNodeFromAiDataWithTheme(nodeData, inheritedTheme, ctx.issues);

  // Expand document component tags in embed HTML
  normalizeEmbedNode(node, ctx);

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
    if (mapped._warnings) {
      ctx.issues.push(...mapped._warnings);
      delete (mapped as Record<string, unknown>)._warnings;
    }
    Object.assign(cloned, mapped);
  }

  // Handle descendants overrides by building old→new ID map
  if (descendantsOverrides) {
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
        if (mapped._warnings) {
          ctx.issues.push(...mapped._warnings);
          delete (mapped as Record<string, unknown>)._warnings;
        }
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

/** Index of the topmost (last) paint of the given type, or -1. */
function findTopPaintIndex(fills: Paint[], type: Paint["type"]): number {
  for (let i = fills.length - 1; i >= 0; i--) {
    if (fills[i].type === type) return i;
  }
  return -1;
}

/**
 * Route legacy single-fill updates into a node's `fills` stack.
 *
 * Per the fillUtils contract, once `node.fills` is set it is the single source
 * of truth and the renderer ignores the legacy `fill`/`imageFill` fields —
 * writing them would be a silent no-op (the op "succeeds" but the canvas never
 * changes). Instead: a legacy `fill` update rewrites the topmost solid paint
 * (or adds one on top), and a legacy `imageFill` update rewrites the topmost
 * image paint (or adds one on top). Skipped when the update itself carries
 * `fills` (the stack then replaces everything wholesale).
 */
function reconcileLegacyFillUpdate(
  node: FlatSceneNode,
  mapped: Partial<FlatSceneNode>,
): Partial<FlatSceneNode> {
  if (!node.fills || mapped.fills !== undefined) return mapped;

  const legacyColor = typeof mapped.fill === "string" ? mapped.fill : undefined;
  const legacyImage = mapped.imageFill as ImageFill | undefined;
  if (legacyColor === undefined && !legacyImage) return mapped;

  const fills = [...node.fills];

  if (legacyColor !== undefined) {
    const idx = findTopPaintIndex(fills, "solid");
    if (idx >= 0) {
      fills[idx] = {
        ...fills[idx],
        color: legacyColor,
        colorBinding: mapped.fillBinding,
      } as Paint;
    } else {
      fills.push(
        createSolidPaint(legacyColor, mapped.fillBinding ? { colorBinding: mapped.fillBinding } : undefined),
      );
    }
  }

  if (legacyImage) {
    const idx = findTopPaintIndex(fills, "image");
    if (idx >= 0) {
      fills[idx] = { ...fills[idx], image: legacyImage } as Paint;
    } else {
      fills.push(createImagePaint(legacyImage));
    }
  }

  return { ...mapped, fills, ...clearLegacyFillProps() };
}

/**
 * Enforce the same component-property rules the sceneStore actions
 * (`setComponentProperties` / `setInstancePropertyValue`) apply, on the AI
 * batch_design path — which merges node data directly into ctx and commits
 * via a raw setState, bypassing those store actions. Throws (surfaced as a
 * batch_design error string) instead of silently no-oping so the model gets
 * actionable feedback.
 */
function assertValidComponentPropertyUpdate(
  mapped: Record<string, unknown>,
  node: FlatSceneNode,
  ctx: ExecutionContext,
  line: number,
): void {
  if (mapped.properties !== undefined) {
    if (node.type !== "frame" || !(node as FlatFrameNode).reusable) {
      throw new Error(
        `Line ${line}: 'properties' can only be declared on a reusable component frame — node "${node.id}" is a ${node.type}${
          node.type === "frame" ? " without reusable: true" : ""
        }`,
      );
    }
  }

  if (mapped.propertyValues !== undefined) {
    if (node.type !== "ref") {
      throw new Error(
        `Line ${line}: 'propertyValues' can only be set on a component instance (type "ref") — node "${node.id}" is a ${node.type}`,
      );
    }
    const componentId = (node as RefNode).componentId;
    const component = ctx.nodesById[componentId];
    if (!component || component.type !== "frame" || !(component as FlatFrameNode).reusable) {
      throw new Error(
        `Line ${line}: instance "${node.id}" references component "${componentId}" which is not a reusable frame`,
      );
    }
    const values = mapped.propertyValues;
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error(`Line ${line}: 'propertyValues' must be an object keyed by property id`);
    }
    const error = getPropertyValuesUpdateError(
      (component as FlatFrameNode).properties,
      values as Record<string, unknown>,
    );
    if (error) {
      throw new Error(`Line ${line}: ${error}`);
    }
  }
}

/**
 * Execute an Update operation.
 * U(nodeId, updateData)
 */
function executeUpdate(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: U() requires 2 arguments (nodeId, updateData)`);
  }

  const path = resolveArg(op.args[0], ctx);
  const updateData = resolveJsonArg(op.args[1]);

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
  if (mapped._warnings) {
    ctx.issues.push(...mapped._warnings);
    delete (mapped as Record<string, unknown>)._warnings;
  }

  assertValidComponentPropertyUpdate(mapped as Record<string, unknown>, node, ctx, op.line);

  let updated = { ...node, ...reconcileLegacyFillUpdate(node, mapped) } as FlatSceneNode;

  // Expand document component tags in embed HTML
  normalizeEmbedNode(updated, ctx);

  // Sync text dimensions if text node
  if (updated.type === "text") {
    updated = syncTextDimensions(updated);
  }

  ctx.nodesById[path] = updated;
}

/**
 * Execute a Replace operation.
 * R(path, nodeData)
 */
function executeReplace(op: ParsedOperation, ctx: ExecutionContext): void {
  if (op.args.length < 2) {
    throw new Error(`Line ${op.line}: R() requires 2 arguments (nodeId, nodeData)`);
  }

  const path = resolveArg(op.args[0], ctx);
  const nodeData = resolveJsonArg(op.args[1]);

  const existingNode = ctx.nodesById[path];
  if (!existingNode) {
    throw new Error(`Line ${op.line}: Node not found: "${path}"`);
  }

  const parentId = ctx.parentById[path];
  const newNode = createNodeFromAiDataWithTheme(
    nodeData,
    resolveInheritedTheme(parentId ?? null, ctx.nodesById, ctx.parentById),
    ctx.issues,
  );

  // Expand document component tags in embed HTML
  normalizeEmbedNode(newNode, ctx);

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

  // Descendants of the replaced subtree get brand-new ids in the new node, so a
  // connector anchored to an old descendant cannot be re-pointed — capture them
  // now (before removal) to drop those orphans after the swap.
  const removedDescendantIds = new Set<string>(
    collectDescendantIds(path, ctx.childrenById)
  );

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

  // The node was replaced in place under a new id — keep any connectors attached
  // to it by re-pointing their endpoints rather than leaving them dangling.
  repointConnectors(path, newNode.id, ctx.nodesById);

  // Connectors anchored to the old (now-removed) descendants can't follow the
  // swap, so drop them like the delete paths do.
  if (removedDescendantIds.size > 0) {
    const orphanedConnectorIds = removeOrphanedConnectors(
      removedDescendantIds,
      ctx.nodesById,
      ctx.parentById,
      ctx.childrenById
    );
    if (orphanedConnectorIds.length > 0) {
      const orphanSet = new Set(orphanedConnectorIds);
      ctx.rootIds = ctx.rootIds.filter((rid) => !orphanSet.has(rid));
    }
  }

  ctx.createdNodeIds.push(newNode.id);

  if (op.binding) {
    ctx.bindings.set(op.binding, newNode.id);
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

  // Capture removed ids (node + descendants) before removal so connectors
  // anchored to any of them are cleaned up too.
  const removedIds = new Set<string>([
    nodeId,
    ...collectDescendantIds(nodeId, ctx.childrenById),
  ]);

  // Remove node and all descendants
  removeNodeAndDescendants(
    nodeId,
    ctx.nodesById,
    ctx.parentById,
    ctx.childrenById
  );

  // Drop connectors that now dangle into the removed nodes (matches native delete).
  const orphanedConnectorIds = removeOrphanedConnectors(
    removedIds,
    ctx.nodesById,
    ctx.parentById,
    ctx.childrenById
  );
  if (orphanedConnectorIds.length > 0) {
    const orphanSet = new Set(orphanedConnectorIds);
    ctx.rootIds = ctx.rootIds.filter((rid) => !orphanSet.has(rid));
  }
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

  // Stub: apply a placeholder image fill.
  const url = `https://placehold.co/600x400?text=${encodeURIComponent(prompt.slice(0, 30))}`;

  // Normalize to the paint stack via getFills (legacy single-fill fields are
  // lazily converted with stable ids — see fillUtils contract), then add or
  // replace the topmost image paint, leaving underlying layers intact. Legacy
  // nodes migrate to `fills` here, so the legacy fields are cleared alongside.
  const fills = [...getFills(node)];
  const newImagePaint = createImagePaint({ url, mode: "fill" });
  const topIdx = fills.length - 1;
  if (topIdx >= 0 && fills[topIdx].type === "image") {
    fills[topIdx] = newImagePaint;
  } else {
    fills.push(newImagePaint);
  }
  ctx.nodesById[nodeId] = {
    ...node,
    fills,
    ...clearLegacyFillProps(),
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
