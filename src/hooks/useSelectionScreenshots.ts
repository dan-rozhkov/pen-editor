import { useEffect, useState } from "react";
import { useSelectionStore } from "@/store/selectionStore";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useModelSupportsVision } from "@/hooks/useImageSupport";
import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";
import { REFERENCE_ONLY_TYPES } from "@/lib/selectionContextTypes";

export { REFERENCE_ONLY_TYPES } from "@/lib/selectionContextTypes";

export interface SelectionContextItem {
  nodeId: string;
  name: string;
  type: string;
  /** null = a reference-only item — we send just the node id (already part
   * of canvasContext's `selectedIds`) and deliberately do NOT attach a
   * screenshot. The agent can call `get_screenshot` with the id itself if it
   * needs to see the node. */
  dataUrl: string | null;
}

// Selection changes rapidly during marquee drag; wait for it to settle before
// paying for a render extraction.
const CAPTURE_DEBOUNCE_MS = 200;

// Stable identity so consumers that memo on the returned array don't re-run
// every render while nothing is selected.
const NO_ITEMS: SelectionContextItem[] = [];

// Screenshotting frame/ref nodes is a poor trade: the node's id already
// goes out in canvasContext's `selectedIds`/`selectedNodes`, so the model
// can call `get_screenshot` itself the moment a turn actually needs pixels
// — attaching one unconditionally on every selection change would spend
// image tokens (or, for a vision-less model, a blocking describeImage round
// trip) whether or not the turn ever looks at it. So these types (see
// `REFERENCE_ONLY_TYPES` in selectionContextTypes.ts, re-exported here) are
// returned as reference-only items (`dataUrl: null`) instead of being
// captured at all.

/**
 * Context about the currently selected canvas nodes, kept in sync with the
 * selection. Used to show selected elements above the chat input and to
 * attach them to the outgoing message — either as an image (most node
 * types) or, for frames/instances, as a bare node id the agent can
 * screenshot itself via `get_screenshot` (see `REFERENCE_ONLY_TYPES` above
 * for why).
 *
 * Image items are gated on **native** vision support
 * (`useModelSupportsVision`), not on `useCanSendImages`. This is deliberate
 * and differs from `ChatInput`'s explicit "Attach image" control, which uses
 * `useCanSendImages` (native vision OR the backend's auxiliary vision
 * fallback): this hook fires automatically, without the user asking, and can
 * attach up to 4 screenshots per canvas selection. With the default config
 * `visionFallback` is true, and an operator can point the backend at a
 * vision-less model, so gating this hook on `canSendImages` would silently
 * attach screenshots the user never requested — each paying for a blocking
 * `describeImage` round trip on the backend before the stream even starts.
 * An explicit attachment is worth that cost because the user asked for it; a
 * silent auto-attach is not. Do not "fix" this inconsistency by unifying the
 * two gates.
 *
 * Reference-only items (frame/ref) are returned regardless of vision
 * support — an id costs no image tokens either way, so a vision-less model
 * still gets a frame reference instead of nothing.
 *
 * Returns an empty list when nothing is selected. For a selection that is
 * entirely image items, also returns empty when the model has no native
 * vision or the PixiJS renderer isn't available (e.g. in unit tests).
 */
export function useSelectionScreenshots(): SelectionContextItem[] {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const model = useChatStore((s) => s.model);
  const canAttach = useModelSupportsVision(model);
  // Captures are tagged with the selection they were taken for, so the
  // result can be DERIVED rather than reset by the effect: a selection the
  // capture doesn't match (nothing selected, or a new selection whose
  // capture is still debouncing) simply reads as empty. That also closes a
  // real gap — during the debounce this used to keep returning the
  // *previous* selection's screenshots, which the chat would attach.
  const [captured, setCaptured] = useState<{
    key: string;
    items: SelectionContextItem[];
  } | null>(null);

  // Re-run only when the *set* of selected ids changes, not on every store
  // write (selectionStore replaces the array on unrelated edits too).
  const selectionKey = selectedIds.join(",");
  // Folding canAttach into the capture key means a vision flip (metadata
  // arriving mid-flight) is immediately visible as a mismatch: a capture
  // taken while canAttach was true reads as stale the instant canAttach
  // flips to false, instead of continuing to be served for up to
  // CAPTURE_DEBOUNCE_MS until the re-capture (tagged with the new key)
  // lands.
  const captureKey = `${selectionKey}::${canAttach}`;

  useEffect(() => {
    if (selectedIds.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const { nodesById } = useSceneStore.getState();
      const items = await Promise.all(
        selectedIds.map(async (id): Promise<SelectionContextItem | null> => {
          const node = nodesById[id];
          if (!node) return null;
          const name = node.name ?? id;
          // Reference-only nodes never get screenshotted, and — unlike
          // image items — aren't gated on vision support: they cost no
          // image tokens.
          if (REFERENCE_ONLY_TYPES.has(node.type)) {
            return { nodeId: id, name, type: node.type, dataUrl: null };
          }
          if (!canAttach) return null;
          const dataUrl = await captureNodeScreenshot(id);
          if (!dataUrl) return null;
          return { nodeId: id, name, type: node.type, dataUrl };
        }),
      );
      if (cancelled) return;
      setCaptured({
        key: captureKey,
        items: items.filter((s): s is SelectionContextItem => s !== null),
      });
    }, CAPTURE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // selectionKey/captureKey stand in for selectedIds/canAttach; both are
    // read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, canAttach]);

  if (selectedIds.length === 0 || captured?.key !== captureKey) {
    return NO_ITEMS;
  }
  return captured.items;
}
