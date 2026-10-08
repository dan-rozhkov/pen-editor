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

interface RegistryMemo {
  scene: NodeMap;
  pages: PageData[];
  activePageId: string;
  registry: ComponentRegistry;
  /** key -> node ids of the masters that LOST to the winner (copied master nodes). */
  shadowed: ReadonlyMap<string, string[]>;
}

let memo: RegistryMemo | null = null;

function buildRegistry(): RegistryMemo {
  const { pages, activePageId } = usePageStore.getState();
  const scene = useSceneStore.getState().nodesById;
  if (memo && memo.scene === scene && memo.pages === pages && memo.activePageId === activePageId) {
    return memo;
  }
  const registry = new Map<string, ComponentMaster>();
  const shadowed = new Map<string, string[]>();
  for (const page of allPageNodes()) {
    for (const { master } of mastersIn(page.nodesById)) {
      if (!registry.has(master.key)) {
        registry.set(master.key, { ...master, pageId: page.pageId });
      } else {
        const list = shadowed.get(master.key) ?? [];
        list.push(master.nodeId ?? "");
        shadowed.set(master.key, list);
      }
    }
  }
  memo = { scene, pages, activePageId, registry, shadowed };
  return memo;
}

/**
 * `key -> master` over every embed with `component`, on the active scene AND
 * on the other pages' snapshots. Derived, never stored: there is no
 * document-level component table. If two masters share a key (a copied
 * master node), the first in page order, then node insertion order, wins —
 * deterministically; `selectDuplicateMasters` lists the losers.
 */
export function selectComponentRegistry(): ComponentRegistry {
  return buildRegistry().registry;
}

/** key -> node ids of shadowed (losing) masters. Empty when every key has one master. */
export function selectDuplicateMasters(): ReadonlyMap<string, string[]> {
  return buildRegistry().shadowed;
}

/** Human-readable warnings for shadowed masters (one key, or all when omitted). */
export function duplicateKeyWarnings(key?: string): string[] {
  const out: string[] = [];
  for (const [k, ids] of selectDuplicateMasters()) {
    if (key !== undefined && k !== key) continue;
    out.push(
      `Component "${k}" has ${ids.length} duplicate master node(s) (${ids.join(", ")}); ` +
        `only the first master is used. Delete the extra copies.`,
    );
  }
  return out;
}

/** The winning master node for `key` and the page it lives on (same winner as the registry). */
export function findWinningMaster(
  key: string,
): { page: PageNodes; node: EmbedNode; master: ComponentMaster } | undefined {
  for (const page of allPageNodes()) {
    const hit = mastersIn(page.nodesById).find((m) => m.master.key === key);
    if (hit) return { page, ...hit };
  }
  return undefined;
}

/** The "Components" page, if one exists. */
export function findComponentsPage(): PageData | undefined {
  return usePageStore.getState().pages.find((p) => p.name === COMPONENTS_PAGE_NAME);
}
