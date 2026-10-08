import type { FlatSceneNode } from "../types/scene";
import { rewriteCssVarRefs } from "../lib/variables/rewriteCssVarRefs";
import { useSceneStore } from "./sceneStore";
import { usePageStore } from "./pageStore";

type RefMap = Record<string, string>;

function rewriteNodes(
  nodesById: Record<string, FlatSceneNode>,
  map: RefMap,
): Record<string, FlatSceneNode> | null {
  let next: Record<string, FlatSceneNode> | null = null;
  for (const id in nodesById) {
    const node = nodesById[id];
    if (node.type !== "embed" || !node.htmlContent) continue;
    const html = rewriteCssVarRefs(node.htmlContent, map);
    if (html === node.htmlContent) continue;
    next ??= { ...nodesById };
    next[id] = { ...node, htmlContent: html };
  }
  return next;
}

/**
 * Rewrite `var(--old)` -> `var(--new)` in the embeds of the ACTIVE page (the
 * live scene store). No history entry (the caller owns the undo step); touched
 * ids go through the dirty channel, so pixiSync diffs only them.
 */
export function rewriteEmbedRefsOnActivePage(map: RefMap): void {
  if (Object.keys(map).length === 0) return;
  const { nodesById, updateNodesWithoutHistory } = useSceneStore.getState();
  const next = rewriteNodes(nodesById, map);
  if (!next) return;
  const updates: Record<string, Partial<FlatSceneNode>> = {};
  for (const id in next) {
    if (next[id] !== nodesById[id]) {
      updates[id] = { htmlContent: (next[id] as { htmlContent: string }).htmlContent };
    }
  }
  updateNodesWithoutHistory(updates);
}

/**
 * Same rewrite for every page that is NOT active. Their nodes live in
 * `pageStore.pages[*].nodesById` (the entry for the active page is stale
 * until the next `saveCurrentPageState`, so it is skipped here).
 */
export function rewriteEmbedRefsOnInactivePages(map: RefMap): void {
  if (Object.keys(map).length === 0) return;
  const { pages, activePageId } = usePageStore.getState();
  let changed = false;
  const nextPages = pages.map((page) => {
    if (page.id === activePageId) return page;
    const next = rewriteNodes(page.nodesById, map);
    if (!next) return page;
    changed = true;
    return { ...page, nodesById: next };
  });
  if (changed) usePageStore.setState({ pages: nextPages });
}
