import type { EmbedComponentMeta, EmbedNode, FlatSceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { listRegionKeys, type ComponentRegistry } from "@/lib/embedComponents";
import { useSceneStore } from "./sceneStore";
import { createSnapshot } from "./sceneStore/helpers/history";
import { usePageStore } from "./pageStore";
import {
  COMPONENTS_PAGE_NAME,
  allPageNodes,
  findComponentsPage,
  findWinningMaster,
} from "./componentRegistry";

const MASTER_WIDTH = 400;
const MASTER_HEIGHT = 240;
const MASTER_GAP = 48;
const MAX_HISTORY = 50;

/** Id of the "Components" page; creates it (without switching to it) when absent. */
export function ensureComponentsPage(): string {
  const existing = findComponentsPage();
  if (existing) return existing.id;
  return usePageStore.getState().addBackgroundPage(COMPONENTS_PAGE_NAME);
}

function nextMasterPosition(nodesById: Record<string, FlatSceneNode>, rootIds: string[]): { x: number; y: number } {
  let y = 0;
  for (const id of rootIds) {
    const n = nodesById[id];
    if (n) y = Math.max(y, n.y + n.height + MASTER_GAP);
  }
  return { x: 0, y };
}

export interface UpsertMasterInput {
  meta: EmbedComponentMeta;
  /** Normalized master HTML (see `validateMaster`). */
  html: string;
}

export interface UpsertMasterResult {
  created: boolean;
  nodeId: string;
  pageId: string;
}

/**
 * Create or update the master embed for `input.meta.key`. A master on the
 * active page goes through the scene store (one undoable history step); a
 * master on another page is patched in that page's snapshot, with a history
 * entry pushed onto THAT page's stacks so undo there still works.
 */
export function upsertMasterNode(input: UpsertMasterInput): UpsertMasterResult {
  const { meta, html } = input;
  const pages = usePageStore.getState();
  const existing = findWinningMaster(meta.key);

  const pageId = existing?.page.pageId ?? ensureComponentsPage();
  const isActive = pageId === pages.activePageId;

  if (isActive) {
    const scene = useSceneStore.getState();
    if (existing) {
      scene.updateNode(existing.node.id, { htmlContent: html, component: meta, name: meta.name } as Partial<EmbedNode>);
      return { created: false, nodeId: existing.node.id, pageId };
    }
    const pos = nextMasterPosition(scene.nodesById, scene.rootIds);
    const node: EmbedNode = {
      id: generateId(),
      type: "embed",
      name: meta.name,
      ...pos,
      width: MASTER_WIDTH,
      height: MASTER_HEIGHT,
      htmlContent: html,
      component: meta,
    };
    scene.addNode(node);
    return { created: true, nodeId: node.id, pageId };
  }

  // Inactive page: patch its snapshot, recording history on that page.
  const page = usePageStore.getState().pages.find((p) => p.id === pageId);
  if (!page) throw new Error("Components page vanished");
  const snapshot = createSnapshot({
    nodesById: page.nodesById,
    parentById: page.parentById,
    childrenById: page.childrenById,
    rootIds: page.rootIds,
    slideOrder: page.slideOrder,
  });
  let nodeId: string;
  let nodesById = page.nodesById;
  let parentById = page.parentById;
  let rootIds = page.rootIds;
  if (existing) {
    nodeId = existing.node.id;
    nodesById = {
      ...page.nodesById,
      [nodeId]: { ...existing.node, htmlContent: html, component: meta, name: meta.name } as unknown as FlatSceneNode,
    };
  } else {
    nodeId = generateId();
    const pos = nextMasterPosition(page.nodesById, page.rootIds);
    const node: EmbedNode = {
      id: nodeId,
      type: "embed",
      name: meta.name,
      ...pos,
      width: MASTER_WIDTH,
      height: MASTER_HEIGHT,
      htmlContent: html,
      component: meta,
    };
    nodesById = { ...page.nodesById, [nodeId]: node as unknown as FlatSceneNode };
    parentById = { ...page.parentById, [nodeId]: null };
    rootIds = [...page.rootIds, nodeId];
  }
  usePageStore.setState((state) => ({
    pages: state.pages.map((p) =>
      p.id === pageId
        ? {
            ...p,
            nodesById,
            parentById,
            rootIds,
            history: { past: [...p.history.past, snapshot].slice(-MAX_HISTORY), future: [] },
          }
        : p,
    ),
  }));
  return { created: !existing, nodeId, pageId };
}

/** Delete the master node for `key`. Returns false when there was none. */
export function removeMasterNode(key: string): boolean {
  const found = findWinningMaster(key);
  if (!found) return false;
  const { activePageId } = usePageStore.getState();
  if (found.page.pageId === activePageId) {
    useSceneStore.getState().deleteNode(found.node.id);
    return true;
  }
  usePageStore.setState((state) => ({
    pages: state.pages.map((p) => {
      if (p.id !== found.page.pageId) return p;
      // Same as upsertMasterNode: record the step on THAT page's stacks so undo works there.
      const snapshot = createSnapshot({
        nodesById: p.nodesById,
        parentById: p.parentById,
        childrenById: p.childrenById,
        rootIds: p.rootIds,
        slideOrder: p.slideOrder,
      });
      // The node and every descendant go; the parent forgets the node.
      const doomed = new Set<string>();
      const collect = (id: string) => {
        doomed.add(id);
        for (const child of p.childrenById[id] ?? []) collect(child);
      };
      collect(found.node.id);
      const parentId = p.parentById[found.node.id];
      const nodesById = { ...p.nodesById };
      const parentById = { ...p.parentById };
      const childrenById = { ...p.childrenById };
      for (const id of doomed) {
        delete nodesById[id];
        delete parentById[id];
        delete childrenById[id];
      }
      if (parentId && childrenById[parentId]) {
        childrenById[parentId] = childrenById[parentId].filter((id) => id !== found.node.id);
      }
      return {
        ...p,
        nodesById,
        parentById,
        childrenById,
        rootIds: p.rootIds.filter((id) => !doomed.has(id)),
        slideOrder: p.slideOrder.filter((id) => !doomed.has(id)),
        history: { past: [...p.history.past, snapshot].slice(-MAX_HISTORY), future: [] },
      };
    }),
  }));
  return true;
}

/** How many embeds (any page, masters excluded) hold at least one region of each key. */
export function countUsage(registry: ComponentRegistry): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of registry.keys()) counts.set(key, 0);
  for (const page of allPageNodes()) {
    for (const id in page.nodesById) {
      const n = page.nodesById[id];
      if (n.type !== "embed") continue;
      const embed = n as unknown as EmbedNode;
      if (embed.component || !embed.htmlContent) continue;
      for (const key of listRegionKeys(embed.htmlContent)) {
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export interface EmbedHtmlUpdate {
  nodeId: string;
  html: string;
}

/**
 * Write new `htmlContent` for embeds on any page. Embeds on the active page
 * go through the scene store as ONE history entry; embeds on other pages are
 * patched in their snapshot (those pages' stacks are untouched). Returns the
 * number of embeds written.
 */
export function applyEmbedHtmlUpdates(updates: EmbedHtmlUpdate[]): number {
  if (updates.length === 0) return 0;
  const byId = new Map(updates.map((u) => [u.nodeId, u.html]));
  const active: Record<string, Partial<EmbedNode>> = {};
  const inactive = new Map<string, Map<string, string>>();
  for (const page of allPageNodes()) {
    for (const id in page.nodesById) {
      const html = byId.get(id);
      if (html === undefined || page.nodesById[id].type !== "embed") continue;
      if (page.isActive) active[id] = { htmlContent: html };
      else {
        const perPage = inactive.get(page.pageId) ?? new Map<string, string>();
        perPage.set(id, html);
        inactive.set(page.pageId, perPage);
      }
    }
  }
  let count = Object.keys(active).length;
  if (count > 0) useSceneStore.getState().updateNodesById(active);
  if (inactive.size > 0) {
    usePageStore.setState((state) => ({
      pages: state.pages.map((p) => {
        const patch = inactive.get(p.id);
        if (!patch) return p;
        const nodesById = { ...p.nodesById };
        for (const [id, html] of patch) {
          nodesById[id] = { ...nodesById[id], htmlContent: html } as unknown as FlatSceneNode;
          count++;
        }
        return { ...p, nodesById };
      }),
    }));
  }
  return count;
}

/** Every embed on every page, with the page it lives on. */
export function listAllEmbeds(): Array<{ node: EmbedNode; pageId: string; isActive: boolean }> {
  const out: Array<{ node: EmbedNode; pageId: string; isActive: boolean }> = [];
  for (const page of allPageNodes()) {
    for (const id in page.nodesById) {
      const n = page.nodesById[id];
      if (n.type === "embed") {
        out.push({ node: n as unknown as EmbedNode, pageId: page.pageId, isActive: page.isActive });
      }
    }
  }
  return out;
}
