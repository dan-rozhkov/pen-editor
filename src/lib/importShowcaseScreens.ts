// Editor-side half of the "Open in Editor" handoff (FIR-62): reads the
// lightweight payload `consumeShowcaseScreensHandoff` left in sessionStorage,
// fetches the app's screens' full HTML from the backend, and drops one
// `embed` node per screen onto the canvas in a row (carousel order, gap
// between screens), as a single undo step.
//
// This module is editor-only — imported from App.tsx, never from showcase
// code — so pulling in the scene stores here is fine; see
// showcaseScreenHandoff.ts for why *that* module has to stay store-free.
import { toast } from "sonner";
import { generateId } from "@/types/scene";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { resolveApiUrl } from "@/lib/apiBase";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { consumeShowcaseScreensHandoff } from "@/lib/showcaseScreenHandoff";

// Horizontal gap between screens laid out in a row, and between the row and
// whatever content already exists on the canvas.
const SCREEN_GAP = 120;

// The backend's own fetch of each screen's HTML (server-side, from S3) is
// itself timed out at 10s — see `FETCH_TIMEOUT_MS` in
// pen-editor-backend/src/routes/showcase.ts. This client-side fetch of the
// backend's aggregate response needs a timeout of its own: an unresponsive
// or half-broken backend would otherwise leave `importShowcaseScreensFromHandoff`
// (and the editor's mount effect awaiting it) hanging indefinitely.
const FETCH_TIMEOUT_MS = 15_000;

interface FetchedScreen {
  id: string;
  title: string;
  width: number;
  height: number;
  htmlContent: string;
}

interface ShowcaseHtmlResponse {
  screens: FetchedScreen[];
}

async function fetchScreensHtml(runId: string): Promise<FetchedScreen[] | null> {
  try {
    const res = await fetch(
      resolveApiUrl(`/api/showcase/${encodeURIComponent(runId)}/html`),
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as ShowcaseHtmlResponse;
    return Array.isArray(data.screens) && data.screens.length > 0 ? data.screens : null;
  } catch {
    return null;
  }
}

/** Right edge of the existing root-level content, or 0 for an empty canvas. */
function findRowStartX(
  nodesById: Record<string, FlatSceneNode>,
  rootIds: string[],
): number {
  let maxX = -Infinity;
  for (const id of rootIds) {
    const node = nodesById[id];
    if (!node || node.visible === false) continue;
    maxX = Math.max(maxX, node.x + node.width);
  }
  return maxX === -Infinity ? 0 : maxX + SCREEN_GAP;
}

/**
 * Consumes the showcase handoff (if any) and imports its screens onto the
 * canvas. Returns true iff something was actually imported, so the caller
 * can decide whether to disturb the rest of the mount sequence.
 *
 * The handoff payload is consumed (removed from sessionStorage) synchronously
 * before any `await`, which is what keeps this one-shot even under React 18
 * Strict Mode's dev-only double-invoke of effects: the second call in the
 * same tick finds nothing left to consume and returns `false` immediately,
 * before ever reaching the fetch below.
 *
 * A failed fetch (404/502/network error) used to fail silently, landing the
 * visitor in an empty editor with no explanation and no way to retry short of
 * going back to the showcase — this now surfaces a toast instead.
 */
export async function importShowcaseScreensFromHandoff(): Promise<boolean> {
  const handoff = consumeShowcaseScreensHandoff();
  if (!handoff) return false;

  const screens = await fetchScreensHtml(handoff.runId);
  if (!screens) {
    toast.error("Couldn't open these screens in the editor. Please try again from the showcase.");
    return false;
  }

  const state = useSceneStore.getState();

  const nodesById = { ...state.nodesById };
  const rootIds = [...state.rootIds];
  let x = findRowStartX(nodesById, rootIds);

  const createdIds: string[] = [];
  const createdNodes: EmbedNode[] = [];
  for (const screen of screens) {
    const id = generateId();
    const node: EmbedNode = {
      id,
      type: "embed",
      name: screen.title || "Screen",
      x,
      y: 0,
      width: screen.width,
      height: screen.height,
      htmlContent: screen.htmlContent,
    };
    nodesById[id] = node as unknown as FlatSceneNode;
    rootIds.push(id);
    createdIds.push(id);
    createdNodes.push(node);
    x += screen.width + SCREEN_GAP;
  }

  // One undo entry for the whole import. `saveHistory` takes the *pre*
  // mutation scene-store state (the same convention `basicMutations.ts`'s
  // mutators use, e.g. `addNode`) — it builds its own snapshot internally
  // and reads selection/variables/etc live off their own stores, none of
  // which have been touched yet at this point. Passing an *already-built*
  // `HistorySnapshot` here (as this used to) happened to still work only
  // because `HistorySnapshot`'s field names are a superset of the state
  // shape `saveHistory` expects; it was building a redundant, easy-to-break
  // second snapshot rather than reusing `state` directly.
  saveHistory(state);
  useSceneStore.setState({
    nodesById,
    parentById: { ...state.parentById, ...Object.fromEntries(createdIds.map((id) => [id, null])) },
    rootIds,
    _cachedTree: null,
  });

  // `useSceneStore.setState` directly, not `setSelectedIds` — that setter
  // pushes its own history entry for the selection change (see
  // `saveSelectionHistoryIfChanged` in selectionStore.ts), which would make
  // this a two-step undo. `saveHistory(state)` above already captured the
  // pre-import selection (via the live selection store, still untouched at
  // that point), so undoing the scene mutation restores it for free without
  // a second entry.
  useSelectionStore.setState({
    selectedIds: createdIds,
    lastSelectedId: createdIds[createdIds.length - 1] ?? null,
    editingNodeId: null,
    editingMode: null,
    editingInstanceId: null,
    instanceContext: null,
  });

  const { width, height } = getCanvasViewportMetrics();
  useViewportStore.getState().fitToContent(createdNodes, width, height);

  return true;
}
