import type { EmbedComponentMeta, FlatSceneNode } from "@/types/scene";
import { usePageStore, type PageData } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";

function emptyPage(id: string, name: string): PageData {
  return {
    id,
    name,
    nodesById: {},
    parentById: {},
    childrenById: {},
    rootIds: [],
    pageBackground: "#f5f5f5",
    expandedFrameIds: new Set<string>(),
    viewport: { scale: 1, x: 0, y: 0 },
    history: { past: [], future: [] },
    guides: [],
    slideOrder: [],
    measurements: [],
    comments: [],
  };
}

/** Reset every store and leave exactly one page, "Page 1" (id `p1`), active. */
export function resetWorld(): void {
  resetStores();
  usePageStore.setState({ pages: [emptyPage("p1", "Page 1")], activePageId: "p1" });
}

export function embedNode(
  id: string,
  htmlContent: string,
  extra: { component?: EmbedComponentMeta; y?: number } = {},
): FlatSceneNode {
  return {
    id,
    type: "embed",
    name: `Screen ${id}`,
    x: 0,
    y: extra.y ?? 0,
    width: 390,
    height: 844,
    htmlContent,
    ...(extra.component ? { component: extra.component } : {}),
  } as unknown as FlatSceneNode;
}

/** Put an embed on the ACTIVE page (the live scene store). */
export function seedEmbed(id: string, htmlContent: string, extra: { component?: EmbedComponentMeta } = {}): void {
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: embedNode(id, htmlContent, extra) },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

/** Add an inactive page holding the given embeds (`{id: html}`). */
export function seedInactivePage(pageId: string, name: string, embeds: Record<string, string>): void {
  const page = emptyPage(pageId, name);
  for (const [id, html] of Object.entries(embeds)) {
    page.nodesById[id] = embedNode(id, html);
    page.parentById[id] = null;
    page.rootIds.push(id);
  }
  usePageStore.setState((s) => ({ pages: [...s.pages, page] }));
}

export function activeHtml(id: string): string {
  return (useSceneStore.getState().nodesById[id] as unknown as { htmlContent: string }).htmlContent;
}

export function pageHtml(pageId: string, id: string): string {
  const page = usePageStore.getState().pages.find((p) => p.id === pageId);
  return (page?.nodesById[id] as unknown as { htmlContent: string }).htmlContent;
}

export function parse(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

/** Let queued microtasks (the component-sync subscriber defers its write) run. */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
