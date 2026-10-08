import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import type { ComponentMaster, ComponentRegistry } from "@/lib/embedComponents";
import { isValidComponentKey } from "@/lib/embedComponents";
import { useSceneStore } from "./sceneStore";
import { usePageStore, type PageData } from "./pageStore";

/** The page that holds component masters. Created on demand. */
export const COMPONENTS_PAGE_NAME = "Components";

type NodeMap = Record<string, FlatSceneNode>;

/** A master embed node found in a scene. */
export interface MasterNode {
  node: EmbedNode;
  master: ComponentMaster;
}

const mastersCache = new WeakMap<NodeMap, MasterNode[]>();

/** All component-master embeds in one page's node map (memoized by map identity). */
export function mastersIn(nodesById: NodeMap): MasterNode[] {
  const cached = mastersCache.get(nodesById);
  if (cached) return cached;
  const out: MasterNode[] = [];
  for (const id in nodesById) {
    const n = nodesById[id];
    if (n.type !== "embed") continue;
    const embed = n as unknown as EmbedNode;
    const meta = embed.component;
    if (!meta || !isValidComponentKey(meta.key)) continue;
    out.push({
      node: embed,
      master: { key: meta.key, meta, html: embed.htmlContent ?? "", nodeId: embed.id },
    });
  }
  mastersCache.set(nodesById, out);
  return out;
}

export interface PageNodes {
  pageId: string;
  name: string;
  nodesById: NodeMap;
  isActive: boolean;
}

/** Every page's node map; the active page reads the live scene, not its stale snapshot. */
export function allPageNodes(): PageNodes[] {
  const { pages, activePageId } = usePageStore.getState();
  const scene = useSceneStore.getState();
  return pages.map((p: PageData) => ({
    pageId: p.id,
    name: p.name,
    nodesById: p.id === activePageId ? scene.nodesById : p.nodesById,
    isActive: p.id === activePageId,
  }));
}

let memo: {
  scene: NodeMap;
  pages: PageData[];
  activePageId: string;
  registry: ComponentRegistry;
} | null = null;

/**
 * `key -> master` over every embed with `component`, on the active scene AND
 * on the other pages' snapshots. Derived, never stored: there is no
 * document-level component table. If two masters share a key (a copied
 * master node), the first in page order wins.
 */
export function selectComponentRegistry(): ComponentRegistry {
  const { pages, activePageId } = usePageStore.getState();
  const scene = useSceneStore.getState().nodesById;
  if (memo && memo.scene === scene && memo.pages === pages && memo.activePageId === activePageId) {
    return memo.registry;
  }
  const registry = new Map<string, ComponentMaster>();
  for (const page of allPageNodes()) {
    for (const { master } of mastersIn(page.nodesById)) {
      if (!registry.has(master.key)) registry.set(master.key, { ...master, pageId: page.pageId });
    }
  }
  memo = { scene, pages, activePageId, registry };
  return registry;
}

/** The "Components" page, if one exists. */
export function findComponentsPage(): PageData | undefined {
  return usePageStore.getState().pages.find((p) => p.name === COMPONENTS_PAGE_NAME);
}
