import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import type { ComponentRegistry } from "@/lib/embedComponents";
import { hasStaleRegions, mayContainComponents, reconcileHtml } from "@/lib/embedComponents";
import { useSceneStore } from "./sceneStore";
import { markNodesDirty } from "./sceneStore/dirtyTracking";
import { usePageStore } from "./pageStore";
import { allPageNodes, selectComponentRegistry } from "./componentRegistry";

type NodeMap = Record<string, FlatSceneNode>;

export interface ReconcileOptions {
  /** Only embeds whose HTML mentions one of these keys. Default: any component region. */
  keys?: Iterable<string>;
  /** Only embeds with a region whose `data-c-rev` is stale (cheap text check). Default: false. */
  onlyStale?: boolean;
  /** Restrict to these page ids. Default: every page. */
  pageIds?: ReadonlySet<string>;
  /** Restrict to these embed node ids. Default: every embed. */
  nodeIds?: ReadonlySet<string>;
  /** Registry to reconcile against. Default: the live one. */
  registry?: ComponentRegistry;
}

function mentionsKey(html: string, keys: string[]): boolean {
  return keys.some((k) => html.includes(`data-c="${k}"`) || html.includes(`data-c='${k}'`));
}

/** Compute `{id -> new html}` for the consumer embeds in one node map. */
function planChanges(
  nodesById: NodeMap,
  registry: ComponentRegistry,
  keys: string[] | null,
  onlyStale: boolean,
  nodeIds: ReadonlySet<string> | undefined,
): Record<string, { from: string; to: string }> {
  const changes: Record<string, { from: string; to: string }> = {};
  for (const id in nodesById) {
    if (nodeIds && !nodeIds.has(id)) continue;
    const n = nodesById[id];
    if (n.type !== "embed") continue;
    const embed = n as unknown as EmbedNode;
    if (embed.component) continue; // masters are never consumers
    const html = embed.htmlContent;
    if (!html || !mayContainComponents(html)) continue;
    if (keys && !mentionsKey(html, keys)) continue;
    if (onlyStale && !hasStaleRegions(html, registry)) continue;
    const next = reconcileHtml(html, registry);
    if (next !== html) changes[id] = { from: html, to: next };
  }
  return changes;
}

let applying = false;

/** True while this module is writing; the scene subscriber ignores its own writes. */
export function isApplyingComponentSync(): boolean {
  return applying;
}

/**
 * Reconcile consumer embeds on every page against the live registry and write
 * the results. The active page is written through `sceneStore.setState`
 * WITHOUT a history snapshot, so the update rides along with whatever step
 * caused it (the master edit that triggered it, or the undo/redo that
 * restored it); inactive pages are patched in their `pageStore` snapshot.
 * Dirty ids are marked inside the setState updater (rendering-performance
 * convention). Returns the number of embeds rewritten.
 */
export function reconcileConsumers(options: ReconcileOptions = {}): number {
  const registry = options.registry ?? selectComponentRegistry();
  const keys = options.keys ? [...options.keys] : null;
  const onlyStale = options.onlyStale ?? false;
  const { activePageId } = usePageStore.getState();

  let rewritten = 0;
  const wasApplying = applying;
  applying = true;
  try {
    const pagePatches = new Map<string, Record<string, { from: string; to: string }>>();
    for (const page of allPageNodes()) {
      if (options.pageIds && !options.pageIds.has(page.pageId)) continue;
      const changes = planChanges(page.nodesById, registry, keys, onlyStale, options.nodeIds);
      if (Object.keys(changes).length === 0) continue;
      if (page.pageId === activePageId) {
        rewritten += applyToScene(changes);
      } else {
        pagePatches.set(page.pageId, changes);
      }
    }
    if (pagePatches.size > 0) rewritten += applyToPages(pagePatches);
  } finally {
    applying = wasApplying;
  }
  return rewritten;
}

function patchNodes(
  nodesById: NodeMap,
  changes: Record<string, { from: string; to: string }>,
): { next: NodeMap; ids: string[] } {
  const next = { ...nodesById };
  const ids: string[] = [];
  for (const [id, change] of Object.entries(changes)) {
    const node = next[id] as unknown as EmbedNode | undefined;
    // Skip a node that changed since the plan was made.
    if (!node || node.htmlContent !== change.from) continue;
    next[id] = { ...node, htmlContent: change.to } as unknown as FlatSceneNode;
    ids.push(id);
  }
  return { next, ids };
}

function applyToScene(changes: Record<string, { from: string; to: string }>): number {
  let count = 0;
  useSceneStore.setState((state) => {
    const { next, ids } = patchNodes(state.nodesById, changes);
    if (ids.length === 0) return state;
    count = ids.length;
    // After the no-op guard, right before returning changed state.
    markNodesDirty(ids);
    return { nodesById: next, _cachedTree: null };
  });
  return count;
}

function applyToPages(patches: Map<string, Record<string, { from: string; to: string }>>): number {
  let count = 0;
  usePageStore.setState((state) => ({
    pages: state.pages.map((page) => {
      const changes = patches.get(page.id);
      if (!changes) return page;
      const { next, ids } = patchNodes(page.nodesById, changes);
      if (ids.length === 0) return page;
      count += ids.length;
      return { ...page, nodesById: next };
    }),
  }));
  return count;
}

/** Lazy catch-up: reconcile every embed with a stale region (document open, page activation). */
export function catchUpStaleRegions(pageIds?: ReadonlySet<string>): number {
  return reconcileConsumers({ onlyStale: true, pageIds });
}

/**
 * Subscribe the editor to component changes:
 *  - a master embed's `htmlContent` / `component` changed (edit, undo, redo,
 *    paste) -> reconcile every consumer on every page;
 *  - any other embed changed and now holds a stale region (undo restored old
 *    markup, pasted region) -> catch those embeds up;
 *  - a page became active -> catch that page up.
 * The follow-up write is deferred to a microtask: a nested `setState` from
 * inside a subscriber would reach later subscribers (pixiSync) out of order.
 */
export function installComponentSync(): () => void {
  let scheduled = false;
  let pendingKeys = new Set<string>();
  let pendingFullCatchUp = false;
  let pendingIds = new Set<string>();

  const flush = () => {
    scheduled = false;
    const keys = pendingKeys;
    const catchUp = pendingFullCatchUp;
    const ids = pendingIds;
    pendingKeys = new Set();
    pendingIds = new Set();
    pendingFullCatchUp = false;
    if (keys.size > 0) reconcileConsumers({ keys });
    if (catchUp) catchUpStaleRegions();
    else if (ids.size > 0) reconcileConsumers({ onlyStale: true, nodeIds: ids });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  const unsubScene = useSceneStore.subscribe((state, prev) => {
    if (applying || state.nodesById === prev.nodesById) return;
    for (const id in state.nodesById) {
      const n = state.nodesById[id];
      if (n.type !== "embed") continue;
      const before = prev.nodesById[id];
      if (before === n) continue;
      const embed = n as unknown as EmbedNode;
      const beforeEmbed = before as unknown as EmbedNode | undefined;
      if (embed.component || beforeEmbed?.component) {
        const sameMaster =
          beforeEmbed &&
          beforeEmbed.htmlContent === embed.htmlContent &&
          beforeEmbed.component === embed.component;
        if (!sameMaster) {
          if (embed.component) pendingKeys.add(embed.component.key);
          if (beforeEmbed?.component) pendingKeys.add(beforeEmbed.component.key);
        }
      } else if (embed.htmlContent && embed.htmlContent.includes("data-c=")) {
        pendingIds.add(id);
      }
    }
    if (pendingKeys.size > 0 || pendingIds.size > 0) schedule();
  });

  const unsubPages = usePageStore.subscribe((state, prev) => {
    if (applying || state.activePageId === prev.activePageId) return;
    pendingFullCatchUp = true;
    schedule();
  });

  return () => {
    unsubScene();
    unsubPages();
  };
}
