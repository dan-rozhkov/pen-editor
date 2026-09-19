import { Container, Graphics } from "pixi.js";
import { useAiPendingScreenStore, type AiPendingScreenDraft } from "@/store/aiPendingScreenStore";
import { useViewportStore } from "@/store/viewportStore";
import { drawDashedRect } from "./selectionOverlay/helpers";
import { createAiOverlayTeardown } from "./aiOverlayLayerLifecycle";

/**
 * Draws a dashed placeholder box for each `batch_design` screen whose
 * position/size header has streamed in but whose HTML has not — see
 * `pendingScreenHeaders.ts` and `batchDesignAdapter.ts`'s `onFrame`.
 *
 * Structurally mirrors `aiSvgPreviewLayer.ts` (rAF-coalesced flush, one
 * child container per key, viewport subscription for dash scale) but there
 * is nothing to rasterize here — a placeholder is just an outline, cleared
 * the moment the real embed node lands.
 */

/** Same accent `aiSvgPreviewLayer.ts` uses, so in-flight agent work reads as
 * one family rather than two unrelated affordances. */
const PLACEHOLDER_COLOR = 0x0d99ff;

interface PendingEntry {
  container: Container;
  /** One Graphics per screen index, drawn fresh whenever screens or scale change. */
  boxes: Graphics[];
  renderedScreens: AiPendingScreenDraft["screens"] | null;
  renderedScale: number | null;
}

export function createAiPendingScreenLayer(overlayContainer: Container): () => void {
  const root = new Container();
  root.label = "ai-pending-screens";
  overlayContainer.addChild(root);

  const entries = new Map<string, PendingEntry>();
  let rafId: number | null = null;

  function removeEntry(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    root.removeChild(entry.container);
    entry.container.destroy({ children: true });
  }

  function draw(entry: PendingEntry, screens: AiPendingScreenDraft["screens"], scale: number): void {
    // Reuse/create exactly `screens.length` Graphics children.
    while (entry.boxes.length < screens.length) {
      const gfx = new Graphics();
      entry.container.addChild(gfx);
      entry.boxes.push(gfx);
    }
    while (entry.boxes.length > screens.length) {
      const gfx = entry.boxes.pop();
      gfx?.destroy();
    }

    screens.forEach((screen, i) => {
      const gfx = entry.boxes[i];
      gfx.clear();
      drawDashedRect(
        gfx,
        { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
        PLACEHOLDER_COLOR,
        scale,
      );
    });

    entry.renderedScreens = screens;
    entry.renderedScale = scale;
  }

  function syncEntry(key: string, draft: AiPendingScreenDraft, scale: number): void {
    let entry = entries.get(key);
    if (!entry) {
      const container = new Container();
      root.addChild(container);
      entry = { container, boxes: [], renderedScreens: null, renderedScale: null };
      entries.set(key, entry);
    }

    // Dashes are baked at the current viewport scale (see drawDashedRect),
    // so a redraw is needed whenever either the screens or the scale
    // changed — without the scale check, dashes would stretch on zoom, the
    // same trap aiSvgPreviewLayer's own comment calls out.
    if (entry.renderedScreens === draft.screens && entry.renderedScale === scale) return;
    draw(entry, draft.screens, scale);
  }

  function flush(): void {
    rafId = null;
    const { drafts } = useAiPendingScreenStore.getState();
    const scale = useViewportStore.getState().scale || 1;

    for (const key of [...entries.keys()]) {
      if (!(key in drafts)) removeEntry(key);
    }
    for (const [key, draft] of Object.entries(drafts)) {
      syncEntry(key, draft, scale);
    }
  }

  function scheduleFlush(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(flush);
  }

  const unsubscribe = useAiPendingScreenStore.subscribe(scheduleFlush);
  // Boxes are drawn in scene coordinates but dash length is baked at the
  // current on-screen scale — a zoom while placeholders are staged must
  // redraw them, same rationale as aiSvgPreviewLayer's own subscription.
  const unsubscribeViewport = useViewportStore.subscribe(scheduleFlush);

  flush();

  return createAiOverlayTeardown({
    overlayContainer,
    root,
    unsubscribes: [unsubscribe, unsubscribeViewport],
    cancelScheduledFlush: () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    destroyAllEntries: () => {
      for (const key of [...entries.keys()]) removeEntry(key);
    },
  });
}
