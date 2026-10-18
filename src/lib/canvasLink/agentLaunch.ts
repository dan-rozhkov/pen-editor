/**
 * Canvas tab -> agent panel launches (docs/canvas-link.md, `launch`).
 *
 * In the desktop agent layout the canvas tab is chatless (`isChatDisabled()`), but the
 * on-canvas agent entry points (frame/embed/element buttons, the empty-embed composer,
 * comment "Send to agent", the showcase hand-off) still work: instead of starting a chat
 * locally they hand a `launch` message to the agent panel through the running canvas host.
 *
 * `canLaunchAgent()` is the ONE predicate every entry point gates on:
 *   chat enabled (a normal editor)  OR  the canvas host is running (chatless + link).
 * Plain chatless mode without a host (`/app?chat=off` in a browser) keeps them hidden.
 * Kept free of heavy imports: `canvasHost.ts` registers itself here.
 */
import { useSyncExternalStore } from "react";
import { isChatDisabled } from "@/lib/chatMode";
import type { ChatLaunchPayload } from "@/types/chat";
import type { ChatLaunchMessagePayload } from "./protocol";

type Poster = (payload: ChatLaunchMessagePayload) => void;

let poster: Poster | null = null;
const listeners = new Set<() => void>();

/** Called by `startCanvasHost` once registered. */
export function setCanvasHostLaunchPoster(next: Poster): void {
  if (poster === next) return;
  poster = next;
  listeners.forEach((cb) => cb());
}

/** Called by the host's stop function; a newer host's poster is left alone. */
export function clearCanvasHostLaunchPoster(mine: Poster): void {
  if (poster !== mine) return;
  poster = null;
  listeners.forEach((cb) => cb());
}

export function isCanvasHostRunning(): boolean {
  return poster !== null;
}

/** Fires when the canvas host starts or stops. */
export function subscribeCanvasHost(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Chat enabled, or a canvas host that can deliver to the agent panel. */
export function canLaunchAgent(): boolean {
  return !isChatDisabled() || isCanvasHostRunning();
}

/** Re-renders when the host starts/stops (the host registers after the first render). */
export function useCanLaunchAgent(): boolean {
  return useSyncExternalStore(subscribeCanvasHost, canLaunchAgent, canLaunchAgent);
}

let launchCounter = 0;

/**
 * Sends a launch to the agent panel. Returns false (nothing sent) without a running host.
 * The panel creates (or reuses) the chat, binds it to THIS tab and sends the message.
 */
export function deliverAgentLaunch(
  payload: ChatLaunchPayload & { nodeIds?: string[]; target?: "new-chat" | "active-chat" }
): boolean {
  if (!poster) return false;
  poster({ target: "new-chat", ...payload });
  return true;
}

/** `launchId` generator used by the host's poster. */
export function nextLaunchId(): string {
  return `launch-${Date.now().toString(36)}-${++launchCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
