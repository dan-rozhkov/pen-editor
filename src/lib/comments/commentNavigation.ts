import { useCommentsStore, type CommentThread } from "@/store/commentsStore";
import { usePageStore } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import {
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
} from "@/utils/nodeUtils";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { resolveAnchorPoint, type NodeRect } from "./commentsLogic";

export interface ThreadLocation {
  /** null = the active page's live threads; otherwise the id of the page holding it. */
  pageId: string | null;
  thread: CommentThread;
}

/**
 * Locate a thread by id: first among the active page's live threads
 * (`pageId: null`), else across other pages' stored `comments`. Pure so it
 * unit-tests without stores.
 */
export function findThreadLocation(
  threadId: string,
  currentPageThreads: CommentThread[],
  otherPages: { id: string; comments?: CommentThread[] }[],
): ThreadLocation | null {
  const here = currentPageThreads.find((t) => t.id === threadId);
  if (here) return { pageId: null, thread: here };
  for (const page of otherPages) {
    const found = (page.comments ?? []).find((t) => t.id === threadId);
    if (found) return { pageId: page.id, thread: found };
  }
  return null;
}

/**
 * The viewport pan offset that puts `world` at the centre of a viewport of the
 * given size, at the given zoom: `pan = viewportCenter - world*scale` (inverse
 * of `screen = world*scale + pan`). Pure.
 */
export function centerOffsetForPoint(
  world: { x: number; y: number },
  scale: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: viewport.width / 2 - world.x * scale,
    y: viewport.height / 2 - world.y * scale,
  };
}

function currentNodeRect(nodeId: string): NodeRect | null {
  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const nodes = state.getNodes();
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const pos = getNodeAbsolutePositionWithLayout(nodes, nodeId, calc);
  if (!pos) return null;
  const size = getNodeEffectiveSize(nodes, nodeId, calc);
  return {
    x: pos.x,
    y: pos.y,
    width: size?.width ?? node.width,
    height: size?.height ?? node.height,
  };
}

/**
 * Navigate the editor to a thread's pin: switch to its page if it lives on
 * another one, then pan the viewport so the pin is centred. No-op if the
 * thread can't be found or its anchor can't be resolved (e.g. unattached).
 */
export function navigateToThread(threadId: string): void {
  const location = findThreadLocation(
    threadId,
    useCommentsStore.getState().threads,
    usePageStore.getState().pages,
  );
  if (!location) return;

  if (location.pageId) {
    usePageStore.getState().switchToPage(location.pageId);
  }

  const point = resolveAnchorPoint(location.thread.anchor, currentNodeRect);
  if (!point) return; // unattached / unresolvable — nothing to pan to

  const viewport = getCanvasViewportMetrics();
  const scale = useViewportStore.getState().scale;
  const offset = centerOffsetForPoint(point, scale, viewport);
  useViewportStore.getState().setPosition(offset.x, offset.y);
}
