import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import type { ComponentRegistry } from "@/lib/embedComponents";
import {
  expandComponentTags,
  expandMasterHtml,
  hasStaleRegions,
  mayContainComponents,
  mentionsRegisteredTag,
  reconcileHtml,
  validateMaster,
} from "@/lib/embedComponents";
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

/** Text test: a region of one of `keys`, or a raw `<c-key>` tag written before the key existed. */
function mentionsKey(html: string, keys: string[]): boolean {
  return keys.some(
    (k) => html.includes(`data-c="${k}"`) || html.includes(`data-c='${k}'`) || html.includes(`<c-${k}`),
  );
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
    if (!html || !(mayContainComponents(html) || html.includes("<c-"))) continue;
    if (keys && !mentionsKey(html, keys)) continue;
    if (onlyStale && !hasStaleRegions(html, registry) && !mentionsRegisteredTag(html, registry)) continue;
    // Raw `<c-key>` tags of keys registered since the embed was written expand now.
    const next = reconcileHtml(html.includes("<c-") ? expandComponentTags(html, registry).html : html, registry);
    if (next !== html) changes[id] = { from: html, to: next };
  }
  return changes;
}

type MasterFilter = { keys: string[] } | { stale: true };

/**
 * Masters are consumers of the keys they contain: a master's stored HTML holds
 * nested regions that go stale when the inner master changes. Re-render those
 * regions (reconcile resolves the whole chain through the registry, so one
 * pass is dependency-complete) and re-normalize through `validateMaster`.
 *
 * A master is reconciled against the registry WITHOUT its own key: its own
 * root is never re-rendered (a shadowed duplicate would be overwritten with
 * the winner's content), only the regions and raw `<c-key>` tags inside it.
 */
function planMasterChanges(
  nodesById: NodeMap,
  registry: ComponentRegistry,
  filter: MasterFilter,
): Record<string, { from: string; to: string }> {
  const changes: Record<string, { from: string; to: string }> = {};
  for (const id in nodesById) {
    const n = nodesById[id];
    if (n.type !== "embed") continue;
    const embed = n as unknown as EmbedNode;
    const meta = embed.component;
    const html = embed.htmlContent;
    if (!meta || !html || !(mayContainComponents(html) || html.includes("<c-"))) continue;
    // Its own key is always in its text; only OTHER keys make it a consumer.
    if ("keys" in filter && !mentionsKey(html, filter.keys.filter((k) => k !== meta.key))) continue;
    const others = new Map(registry);
    others.delete(meta.key);
    if ("stale" in filter && !hasStaleRegions(html, others) && !mentionsRegisteredTag(html, others)) continue;
    const expanded = expandMasterHtml(html, meta.key, registry);
    if (expanded.error) continue;
    const validated = validateMaster(reconcileHtml(expanded.html, others), meta.key, meta.variants);
    if (validated.ok && validated.master.html !== html) {
      changes[id] = { from: html, to: validated.master.html };
    }
  }
  return changes;
}

let applying = false;

/** True while this module is writing; the scene subscriber ignores its own writes. */
export function isApplyingComponentSync(): boolean {
  return applying;
}

type Changes = Record<string, { from: string; to: string }>;

/** Plan per page with `plan` and write the results; returns the number of embeds rewritten. */
function planAndWrite(
  pageIds: ReadonlySet<string> | undefined,
  plan: (nodesById: NodeMap) => Changes,
): number {
  const { activePageId } = usePageStore.getState();
  let rewritten = 0;
  const pagePatches = new Map<string, Changes>();
  for (const page of allPageNodes()) {
    if (pageIds && !pageIds.has(page.pageId)) continue;
    const changes = plan(page.nodesById);
    if (Object.keys(changes).length === 0) continue;
    if (page.pageId === activePageId) rewritten += applyToScene(changes);
    else pagePatches.set(page.pageId, changes);
  }
  if (pagePatches.size > 0) rewritten += applyToPages(pagePatches);
  return rewritten;
}

/** Nested-chain depth cap for the master refresh loop (cycles are refused at define time). */
const MAX_MASTER_PASSES = 12;

/**
 * Reconcile consumer embeds on every page against the live registry and write
 * the results. When `keys` is given (or `onlyStale`, the catch-up), masters
 * that contain those keys (or hold stale regions) are refreshed FIRST (inner
 * before outer, to a fixed point: each pass re-plans only the masters that
 * mention a key rewritten in the PREVIOUS pass), so the consumers are
 * reconciled against up-to-date masters. The active page is written
 * through `sceneStore.setState` WITHOUT a history snapshot, so the update
 * rides along with whatever step caused it (the master edit that triggered
 * it, or the undo/redo that restored it); inactive pages are patched in their
 * `pageStore` snapshot. Dirty ids are marked inside the setState updater
 * (rendering-performance convention). Returns the number of embeds rewritten.
 */
export function reconcileConsumers(options: ReconcileOptions = {}): number {
  const keys = options.keys ? [...options.keys] : null;
  const onlyStale = options.onlyStale ?? false;

  let rewritten = 0;
  const wasApplying = applying;
  applying = true;
  try {
    if ((keys || onlyStale) && !options.registry && !options.nodeIds) {
      let filter: MasterFilter = keys ? { keys } : { stale: true };
      const changedKeys = new Set<string>();
      for (let pass = 0; pass < MAX_MASTER_PASSES; pass++) {
        const registry = selectComponentRegistry();
        const passKeys = new Set<string>();
        const count = planAndWrite(options.pageIds, (nodes) => {
          const changes = planMasterChanges(nodes, registry, filter);
          for (const id in changes) {
            const key = (nodes[id] as unknown as EmbedNode).component?.key;
            if (key) passKeys.add(key);
          }
          return changes;
        });
        if (count === 0) break;
        rewritten += count;
        for (const k of passKeys) changedKeys.add(k);
        if (pass === MAX_MASTER_PASSES - 1) {
          console.warn(
            `Component dependency chain is deeper than ${MAX_MASTER_PASSES} levels; ` +
              `outer components may be out of date until the next edit.`,
          );
        }
        filter = { keys: [...passKeys] };
      }
      if (keys) for (const k of changedKeys) if (!keys.includes(k)) keys.push(k);
    }
    const registry = options.registry ?? selectComponentRegistry();
    rewritten += planAndWrite(options.pageIds, (nodes) =>
      planChanges(nodes, registry, keys, onlyStale, options.nodeIds),
    );
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

  // Ids of the embed nodes, so a geometry-only change (drag, resize: same
  // `htmlContent`) is judged by looking at those nodes alone. The set is
  // rebuilt by a full scan only when the node set itself changed (`parentById`
  // / `rootIds` are replaced by every add, delete, move and restore, and by
  // no property update).
  let embedIds: Set<string> | null = null;

  const inspect = (id: string, next: FlatSceneNode, prevNode: FlatSceneNode | undefined) => {
    if (next === prevNode) return;
    const embed = next as unknown as EmbedNode;
    const before = prevNode as unknown as EmbedNode | undefined;
    const sameHtml = before !== undefined && before.htmlContent === embed.htmlContent;
    if (embed.component || before?.component) {
      if (sameHtml && before.component === embed.component) return;
      if (embed.component) pendingKeys.add(embed.component.key);
      if (before?.component) pendingKeys.add(before.component.key);
    } else if (!sameHtml && embed.htmlContent && embed.htmlContent.includes("data-c=")) {
      pendingIds.add(id);
    }
  };

  const unsubScene = useSceneStore.subscribe((state, prev) => {
    if (applying || state.nodesById === prev.nodesById) return;
    const nodes = state.nodesById;
    const structural =
      embedIds === null || state.parentById !== prev.parentById || state.rootIds !== prev.rootIds;
    if (structural) {
      embedIds = new Set();
      for (const id in nodes) {
        if (nodes[id].type !== "embed") continue;
        embedIds.add(id);
        inspect(id, nodes[id], prev.nodesById[id]);
      }
    } else {
      for (const id of embedIds as Set<string>) {
        const n = nodes[id];
        if (!n || n.type !== "embed") continue;
        inspect(id, n, prev.nodesById[id]);
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
