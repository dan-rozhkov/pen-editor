import type {
  FlatFrameNode,
  FlatSceneNode,
  FrameNode,
  GroupNode,
  InstanceOverride,
  RefNode,
  SceneNode,
} from "@/types/scene";
import {
  applyLayoutToChildren,
  calculateFrameLayout,
  calculateFrameIntrinsicSize,
} from "@/utils/yogaLayout";
import { deepCloneNode } from "@/utils/cloneNode";
import { hasTextMeasureProps, syncTextDimensions } from "@/store/sceneStore/helpers/textSync";

export interface SnapshotLayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedComponentSnapshot {
  componentId: string;
  revision: number;
  tree: FrameNode;
}

export interface ResolvedInstanceSnapshot {
  instanceId: string;
  componentId: string;
  componentRevision: number;
  instanceRevision: number;
  rootSizeSignature: string;
  tree: FrameNode;
  nodesByPath: Record<string, SceneNode>;
  childrenByPath: Record<string, string[]>;
  layoutBoundsByPath: Record<string, SnapshotLayoutBounds>;
  pathOrder: string[];
  flatNodesById: Record<string, FlatSceneNode>;
  flatChildrenById: Record<string, string[]>;
}

export interface InstanceDependencyGraph {
  componentToComponents: Record<string, string[]>;
  componentToInstances: Record<string, string[]>;
  reverseComponentDeps: Record<string, string[]>;
}

export interface InstanceInvalidationResult {
  changedIds: string[];
  affectedComponentIds: string[];
  affectedInstanceIds: string[];
}

interface SceneSnapshotInput {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  parentById: Record<string, string | null>;
}

interface CacheContext {
  scene: SceneSnapshotInput | null;
  dependencyGraph: InstanceDependencyGraph;
  componentRevisionById: Map<string, number>;
  instanceRevisionById: Map<string, number>;
  resolvedComponentCache: Map<string, ResolvedComponentSnapshot>;
  resolvedInstanceCache: Map<string, ResolvedInstanceSnapshot>;
  lastInvalidation: InstanceInvalidationResult;
}

const cacheContext: CacheContext = {
  scene: null,
  dependencyGraph: {
    componentToComponents: {},
    componentToInstances: {},
    reverseComponentDeps: {},
  },
  componentRevisionById: new Map(),
  instanceRevisionById: new Map(),
  resolvedComponentCache: new Map(),
  resolvedInstanceCache: new Map(),
  lastInvalidation: {
    changedIds: [],
    affectedComponentIds: [],
    affectedInstanceIds: [],
  },
};

function shallowEqualArray(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getChangedIds(
  nextState: SceneSnapshotInput,
  prevState: SceneSnapshotInput | null,
): Set<string> {
  const changed = new Set<string>();
  if (!prevState) {
    for (const id of Object.keys(nextState.nodesById)) changed.add(id);
    for (const id of Object.keys(nextState.childrenById)) changed.add(id);
    return changed;
  }

  for (const id of Object.keys(nextState.nodesById)) {
    if (nextState.nodesById[id] !== prevState.nodesById[id]) changed.add(id);
  }
  for (const id of Object.keys(prevState.nodesById)) {
    if (!nextState.nodesById[id]) changed.add(id);
  }
  for (const id of Object.keys(nextState.childrenById)) {
    if (!shallowEqualArray(nextState.childrenById[id], prevState.childrenById[id])) {
      changed.add(id);
    }
  }
  for (const id of Object.keys(prevState.childrenById)) {
    if (!nextState.childrenById[id]) changed.add(id);
  }
  return changed;
}

function markReusableAncestors(
  startId: string,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  target: Set<string>,
): void {
  let current: string | null = startId;
  while (current != null) {
    const node = nodesById[current];
    if (node?.type === "frame" && (node as FlatFrameNode).reusable) {
      target.add(current);
    }
    current = parentById[current] ?? null;
  }
}

function buildDependencyGraph(
  state: SceneSnapshotInput,
): InstanceDependencyGraph {
  const componentToComponents = new Map<string, Set<string>>();
  const componentToInstances = new Map<string, Set<string>>();
  const reverseComponentDeps = new Map<string, Set<string>>();

  for (const [id, node] of Object.entries(state.nodesById)) {
    if (node.type === "frame" && (node as FlatFrameNode).reusable) {
      if (!componentToComponents.has(id)) componentToComponents.set(id, new Set());
      if (!reverseComponentDeps.has(id)) reverseComponentDeps.set(id, new Set());
    }
  }

  for (const [id, node] of Object.entries(state.nodesById)) {
    if (node.type !== "ref") continue;
    const refNode = node as RefNode;

    if (!componentToInstances.has(refNode.componentId)) {
      componentToInstances.set(refNode.componentId, new Set());
    }
    componentToInstances.get(refNode.componentId)!.add(id);

    let current = state.parentById[id] ?? null;
    while (current != null) {
      const currentNode = state.nodesById[current];
      if (currentNode?.type === "frame" && (currentNode as FlatFrameNode).reusable) {
        if (!componentToComponents.has(current)) {
          componentToComponents.set(current, new Set());
        }
        componentToComponents.get(current)!.add(refNode.componentId);
        if (!reverseComponentDeps.has(refNode.componentId)) {
          reverseComponentDeps.set(refNode.componentId, new Set());
        }
        reverseComponentDeps.get(refNode.componentId)!.add(current);
      }
      current = state.parentById[current] ?? null;
    }
  }

  return {
    componentToComponents: Object.fromEntries(
      Array.from(componentToComponents.entries()).map(([id, deps]) => [id, Array.from(deps)]),
    ),
    componentToInstances: Object.fromEntries(
      Array.from(componentToInstances.entries()).map(([id, deps]) => [id, Array.from(deps)]),
    ),
    reverseComponentDeps: Object.fromEntries(
      Array.from(reverseComponentDeps.entries()).map(([id, deps]) => [id, Array.from(deps)]),
    ),
  };
}

function expandAffectedComponents(
  affected: Set<string>,
  nextGraph: InstanceDependencyGraph,
  prevGraph: InstanceDependencyGraph,
): Set<string> {
  const reverse = new Map<string, Set<string>>();

  const addReverse = (graph: InstanceDependencyGraph): void => {
    for (const [componentId, dependents] of Object.entries(graph.reverseComponentDeps)) {
      if (!reverse.has(componentId)) reverse.set(componentId, new Set());
      const target = reverse.get(componentId)!;
      for (const dependentId of dependents) target.add(dependentId);
    }
  };

  addReverse(nextGraph);
  addReverse(prevGraph);

  const queue = Array.from(affected);
  const expanded = new Set(affected);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependentId of reverse.get(current) ?? []) {
      if (expanded.has(dependentId)) continue;
      expanded.add(dependentId);
      queue.push(dependentId);
    }
  }
  return expanded;
}

function syncRevisionMap(
  ids: Iterable<string>,
  revisions: Map<string, number>,
): void {
  const valid = new Set(ids);
  for (const id of valid) {
    if (!revisions.has(id)) revisions.set(id, 0);
  }
  for (const id of Array.from(revisions.keys())) {
    if (!valid.has(id)) revisions.delete(id);
  }
}

function bumpRevisions(ids: Iterable<string>, revisions: Map<string, number>): void {
  for (const id of ids) {
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
  }
}

function invalidateEntries(
  ids: Iterable<string>,
  cache: Map<string, unknown>,
): void {
  for (const id of ids) {
    cache.delete(id);
  }
}

function ensureSceneContext(
  state: SceneSnapshotInput,
): void {
  const prevState = cacheContext.scene;
  if (
    prevState &&
    prevState.nodesById === state.nodesById &&
    prevState.childrenById === state.childrenById &&
    prevState.parentById === state.parentById
  ) {
    return;
  }

  const changedIds = getChangedIds(state, prevState);
  const affectedComponents = new Set<string>();
  for (const id of changedIds) {
    if (state.nodesById[id]) {
      markReusableAncestors(id, state.nodesById, state.parentById, affectedComponents);
    }
    if (prevState?.nodesById[id]) {
      markReusableAncestors(id, prevState.nodesById, prevState.parentById, affectedComponents);
    }
  }

  const nextGraph = buildDependencyGraph(state);
  const prevGraph = cacheContext.dependencyGraph;
  const expandedComponents = expandAffectedComponents(affectedComponents, nextGraph, prevGraph);

  const componentIds = Object.keys(nextGraph.componentToComponents);
  syncRevisionMap(componentIds, cacheContext.componentRevisionById);
  bumpRevisions(expandedComponents, cacheContext.componentRevisionById);
  invalidateEntries(expandedComponents, cacheContext.resolvedComponentCache);

  const nextRefIds = Object.entries(state.nodesById)
    .filter(([, node]) => node.type === "ref")
    .map(([id]) => id);
  syncRevisionMap(nextRefIds, cacheContext.instanceRevisionById);

  const directlyChangedInstanceIds = new Set<string>();
  for (const id of changedIds) {
    if (state.nodesById[id]?.type === "ref" || prevState?.nodesById[id]?.type === "ref") {
      directlyChangedInstanceIds.add(id);
    }
  }

  const affectedInstanceIds = new Set<string>(directlyChangedInstanceIds);
  for (const componentId of expandedComponents) {
    for (const instanceId of nextGraph.componentToInstances[componentId] ?? []) {
      affectedInstanceIds.add(instanceId);
    }
  }

  bumpRevisions(directlyChangedInstanceIds, cacheContext.instanceRevisionById);
  invalidateEntries(affectedInstanceIds, cacheContext.resolvedInstanceCache);

  cacheContext.scene = state;
  cacheContext.dependencyGraph = nextGraph;
  cacheContext.lastInvalidation = {
    changedIds: Array.from(changedIds),
    affectedComponentIds: Array.from(expandedComponents),
    affectedInstanceIds: Array.from(affectedInstanceIds),
  };
}

function getOverrideForPath(
  overrides: RefNode["overrides"],
  path: string,
): InstanceOverride | undefined {
  return overrides?.[path];
}

function getResolvedNodeAtPath(
  node: SceneNode,
  path: string,
  overrides: RefNode["overrides"] | undefined,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string>,
): SceneNode | null {
  const override = getOverrideForPath(overrides, path);
  if (override?.kind === "replace") {
    return normalizeResolvedTree(
      deepCloneNode(override.node),
      state,
      visitedComponentIds,
    );
  }

  const updateProps = override?.kind === "update" ? override.props : {};
  let updated = { ...node, ...updateProps } as SceneNode;
  if (updated.enabled === false) return null;

  if (
    updated.type === "text" &&
    Object.keys(updateProps).length > 0 &&
    hasTextMeasureProps(updateProps as Partial<SceneNode>)
  ) {
    updated = syncTextDimensions(updated);
  }

  if (updated.type === "frame" || updated.type === "group") {
    const nextChildren = updated.children
      .map((child) =>
        getResolvedNodeAtPath(
          child,
          path ? `${path}/${child.id}` : child.id,
          overrides,
          state,
          visitedComponentIds,
        ),
      )
      .filter(Boolean) as SceneNode[];
    return {
      ...updated,
      children: nextChildren,
    } as SceneNode;
  }

  return normalizeResolvedTree(updated, state, visitedComponentIds);
}

function applyOverridesToTree(
  tree: FrameNode,
  overrides: RefNode["overrides"] | undefined,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string>,
): FrameNode {
  if (!overrides || Object.keys(overrides).length === 0) {
    return deepCloneNode(tree) as FrameNode;
  }

  const nextChildren = tree.children
    .map((child) => getResolvedNodeAtPath(child, child.id, overrides, state, visitedComponentIds))
    .filter(Boolean) as SceneNode[];
  return {
    ...(deepCloneNode(tree) as FrameNode),
    children: nextChildren,
  };
}

function normalizeResolvedTree(
  node: SceneNode,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string>,
): SceneNode {
  if (node.type === "ref") {
    const nested = buildResolvedFrameForRef(
      node as RefNode,
      state,
      visitedComponentIds,
    );
    return nested ?? node;
  }

  if (node.type === "frame") {
    return {
      ...(node as FrameNode),
      children: node.children.map((child) =>
        normalizeResolvedTree(child, state, visitedComponentIds),
      ),
    } as FrameNode;
  }

  if (node.type === "group") {
    return {
      ...(node as GroupNode),
      children: node.children.map((child) =>
        normalizeResolvedTree(child, state, visitedComponentIds),
      ),
    } as GroupNode;
  }

  return node;
}

function materializeLayoutTree(node: SceneNode): SceneNode {
  if (node.type === "frame") {
    const frameNode = node as FrameNode;
    const normalizedChildren = frameNode.children.map((child) =>
      materializeLayoutTree(child),
    );
    const normalizedFrame = {
      ...frameNode,
      children: normalizedChildren,
    } as FrameNode;

    if (!normalizedFrame.layout?.autoLayout) {
      return normalizedFrame;
    }

    const laidOutChildren = applyLayoutToChildren(
      normalizedFrame.children,
      calculateFrameLayout(normalizedFrame),
    );
    const layoutById = new Map(
      laidOutChildren.map((child) => [child.id, child]),
    );

    const nextChildren = normalizedFrame.children.map((child) => {
      const laidOutChild = layoutById.get(child.id);
      if (!laidOutChild) return child;
      return materializeLayoutTree({
        ...child,
        x: laidOutChild.x,
        y: laidOutChild.y,
        width: laidOutChild.width,
        height: laidOutChild.height,
      } as SceneNode);
    });

    const fitWidth = normalizedFrame.sizing?.widthMode === "fit_content";
    const fitHeight = normalizedFrame.sizing?.heightMode === "fit_content";
    if (!fitWidth && !fitHeight) {
      return {
        ...normalizedFrame,
        children: nextChildren,
      };
    }

    const intrinsicSize = calculateFrameIntrinsicSize(
      {
        ...normalizedFrame,
        children: nextChildren,
      },
      { fitWidth, fitHeight },
    );

    return {
      ...normalizedFrame,
      width: fitWidth ? intrinsicSize.width : normalizedFrame.width,
      height: fitHeight ? intrinsicSize.height : normalizedFrame.height,
      children: nextChildren,
    };
  }

  if (node.type === "group") {
    return {
      ...(node as GroupNode),
      children: node.children.map((child) => materializeLayoutTree(child)),
    } as GroupNode;
  }

  return node;
}

function buildTreeFromFlat(
  nodeId: string,
  state: SceneSnapshotInput,
): SceneNode | null {
  const node = state.nodesById[nodeId];
  if (!node) return null;
  if (node.type !== "frame" && node.type !== "group") {
    return node as SceneNode;
  }

  const childIds = state.childrenById[nodeId] ?? [];
  const children = childIds
    .map((childId) => buildTreeFromFlat(childId, state))
    .filter(Boolean) as SceneNode[];
  return {
    ...(node as FlatFrameNode | GroupNode),
    children,
  } as SceneNode;
}

function buildResolvedComponentTree(
  componentId: string,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string>,
): FrameNode | null {
  const component = state.nodesById[componentId];
  if (!component || component.type !== "frame" || !(component as FlatFrameNode).reusable) {
    return null;
  }

  if (visitedComponentIds.has(componentId)) {
    return null;
  }

  const nextVisited = new Set(visitedComponentIds);
  nextVisited.add(componentId);

  const tree = buildTreeFromFlat(componentId, state);
  if (!tree || tree.type !== "frame") return null;

  const normalized = normalizeResolvedTree(tree as FrameNode, state, nextVisited);
  return materializeLayoutTree(normalized) as FrameNode;
}

function buildResolvedFrameForRef(
  refNode: RefNode,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string>,
): FrameNode | null {
  const componentSnapshot = getResolvedComponentSnapshot(
    refNode.componentId,
    state,
    visitedComponentIds,
  );
  if (!componentSnapshot) return null;

  const resolvedTree = applyOverridesToTree(
    componentSnapshot.tree,
    refNode.overrides,
    state,
    visitedComponentIds,
  );
  const laidOutTree = materializeLayoutTree(resolvedTree) as FrameNode;

  return {
    ...laidOutTree,
    id: refNode.id,
    x: 0,
    y: 0,
    width: refNode.width,
    height: refNode.height,
    fill: refNode.fill ?? laidOutTree.fill,
    stroke: refNode.stroke ?? laidOutTree.stroke,
    strokeWidth: refNode.strokeWidth ?? laidOutTree.strokeWidth,
    fillBinding: refNode.fillBinding ?? laidOutTree.fillBinding,
    strokeBinding: refNode.strokeBinding ?? laidOutTree.strokeBinding,
    sizing: refNode.sizing ?? laidOutTree.sizing,
    visible: refNode.visible,
    enabled: refNode.enabled,
  };
}

function flattenSnapshotTree(
  node: SceneNode,
  targetNodesById: Record<string, FlatSceneNode>,
  targetChildrenById: Record<string, string[]>,
): void {
  if (node.type === "frame" || node.type === "group") {
    const { children, ...flatNode } = node;
    targetNodesById[node.id] = flatNode as FlatSceneNode;
    targetChildrenById[node.id] = children.map((child) => child.id);
    for (const child of children) {
      flattenSnapshotTree(child, targetNodesById, targetChildrenById);
    }
    return;
  }
  targetNodesById[node.id] = node as FlatSceneNode;
}

function collectSnapshotMaps(tree: FrameNode): Pick<
  ResolvedInstanceSnapshot,
  "nodesByPath" | "childrenByPath" | "layoutBoundsByPath" | "pathOrder" | "flatNodesById" | "flatChildrenById"
> {
  const nodesByPath: Record<string, SceneNode> = {};
  const childrenByPath: Record<string, string[]> = { "": [] };
  const layoutBoundsByPath: Record<string, SnapshotLayoutBounds> = {};
  const pathOrder: string[] = [];
  const flatNodesById: Record<string, FlatSceneNode> = {};
  const flatChildrenById: Record<string, string[]> = {};

  flattenSnapshotTree(tree, flatNodesById, flatChildrenById);

  const visit = (
    nodes: SceneNode[],
    parentPath: string,
    accX: number,
    accY: number,
  ): void => {
    const childPaths: string[] = [];
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}/${node.id}` : node.id;
      childPaths.push(path);
      pathOrder.push(path);
      nodesByPath[path] = node;
      layoutBoundsByPath[path] = {
        x: accX + node.x,
        y: accY + node.y,
        width: node.width,
        height: node.height,
      };
      if (node.type === "frame" || node.type === "group") {
        visit(node.children, path, accX + node.x, accY + node.y);
      }
    }
    childrenByPath[parentPath] = childPaths;
  };

  visit(tree.children, "", 0, 0);

  return {
    nodesByPath,
    childrenByPath,
    layoutBoundsByPath,
    pathOrder,
    flatNodesById,
    flatChildrenById,
  };
}

function getRootSizeSignature(refNode: RefNode): string {
  return [
    refNode.width,
    refNode.height,
    refNode.fill ?? "",
    refNode.stroke ?? "",
    refNode.strokeWidth ?? "",
    refNode.visible ?? true,
    refNode.enabled ?? true,
  ].join("|");
}

export function getResolvedComponentSnapshot(
  componentId: string,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string> = new Set(),
): ResolvedComponentSnapshot | null {
  ensureSceneContext(state);
  const revision = cacheContext.componentRevisionById.get(componentId) ?? 0;
  const cached = cacheContext.resolvedComponentCache.get(componentId);
  if (cached && cached.revision === revision) {
    return cached;
  }

  const tree = buildResolvedComponentTree(componentId, state, visitedComponentIds);
  if (!tree) return null;

  const snapshot: ResolvedComponentSnapshot = {
    componentId,
    revision,
    tree,
  };
  cacheContext.resolvedComponentCache.set(componentId, snapshot);
  return snapshot;
}

export function getResolvedInstanceSnapshot(
  refNode: RefNode,
  state: SceneSnapshotInput,
  visitedComponentIds: Set<string> = new Set(),
): ResolvedInstanceSnapshot | null {
  ensureSceneContext(state);
  const componentRevision = cacheContext.componentRevisionById.get(refNode.componentId) ?? 0;
  const instanceRevision = cacheContext.instanceRevisionById.get(refNode.id) ?? 0;
  const rootSizeSignature = getRootSizeSignature(refNode);
  const cached = cacheContext.resolvedInstanceCache.get(refNode.id);
  if (
    cached &&
    cached.componentRevision === componentRevision &&
    cached.instanceRevision === instanceRevision &&
    cached.rootSizeSignature === rootSizeSignature
  ) {
    return cached;
  }

  const nextVisited = new Set(visitedComponentIds);
  nextVisited.add(refNode.componentId);
  const tree = buildResolvedFrameForRef(refNode, state, nextVisited);
  if (!tree) return null;

  const maps = collectSnapshotMaps(tree);
  const snapshot: ResolvedInstanceSnapshot = {
    instanceId: refNode.id,
    componentId: refNode.componentId,
    componentRevision,
    instanceRevision,
    rootSizeSignature,
    tree,
    ...maps,
  };
  cacheContext.resolvedInstanceCache.set(refNode.id, snapshot);
  return snapshot;
}

export function getInstanceDependencyGraph(
  state: SceneSnapshotInput,
): InstanceDependencyGraph {
  ensureSceneContext(state);
  return cacheContext.dependencyGraph;
}

export function getLastInstanceInvalidation(
  state: SceneSnapshotInput,
): InstanceInvalidationResult {
  ensureSceneContext(state);
  return cacheContext.lastInvalidation;
}

export function clearInstanceSnapshotCaches(): void {
  cacheContext.resolvedComponentCache.clear();
  cacheContext.resolvedInstanceCache.clear();
}
