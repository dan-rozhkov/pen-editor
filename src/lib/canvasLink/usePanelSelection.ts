import { useCallback, useSyncExternalStore } from "react";
import { getPanelClient, isPanelCanvasLinkActive } from "./panelRuntime";
import type { SelectionChipsSnapshot } from "./protocol";

const noopSubscribe = () => () => {};

/**
 * The selection chips of the canvas tab this chat is bound to (first listed tab while unbound),
 * published over the canvas link. Null outside the desktop agent panel, so the editor reads its
 * own stores, and null while the panel knows of no tab or no snapshot. Display only.
 */
export function usePanelSelection(sessionId?: string): SelectionChipsSnapshot | null {
  const client = isPanelCanvasLinkActive() ? getPanelClient() : null;
  const subscribe = useCallback((cb: () => void) => (client ? client.subscribe(cb) : noopSubscribe()), [client]);
  const getSnapshot = useCallback(() => client?.selectionFor(sessionId) ?? null, [client, sessionId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
