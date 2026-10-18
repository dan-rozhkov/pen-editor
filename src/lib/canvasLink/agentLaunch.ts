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
import { toast } from "sonner";
import { isChatDisabled } from "@/lib/chatMode";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { ChatLaunchPayload } from "@/types/chat";
import type { ChatLaunchMessagePayload } from "./protocol";

/** Posts a `launch` through the running host; returns its `launchId`, or null when nothing was sent. */
type Poster = (payload: ChatLaunchMessagePayload, launchId?: string) => string | null;

/**
 * How long a canvas tab waits for the panel's `launch-ack`. The panel acks once the chat exists and is
 * bound (a tab probe plus a tab-list round trip, each an IPC hop that can be slow on a loaded machine),
 * BEFORE it prefetches the tab's context (up to 2 s), so this only has to cover probe + bind.
 */
export const LAUNCH_ACK_TIMEOUT_MS = 8000;
export const LAUNCH_NO_ACK_MESSAGE = "The agent panel did not respond.";

let poster: Poster | null = null;
const listeners = new Set<() => void>();
const pendingAcks = new Map<string, (error: string | null) => void>();

/** Called by `startCanvasHost` once its `register()` succeeded. */
export function setCanvasHostLaunchPoster(next: Poster): void {
  if (poster === next) return;
  poster = next;
  listeners.forEach((cb) => cb());
}

/** Called by the host's stop function; a newer host's poster is left alone. */
export function clearCanvasHostLaunchPoster(mine: Poster): void {
  if (poster !== mine) return;
  poster = null;
  // Nobody will answer these any more.
  for (const settle of [...pendingAcks.values()]) settle("The canvas host stopped.");
  listeners.forEach((cb) => cb());
}

/** The host received the panel's `launch-ack` (`error` = the panel refused the launch). */
export function resolveLaunchAck(launchId: string, error?: string): void {
  pendingAcks.get(launchId)?.(error ?? null);
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
 * Sends a launch to the agent panel and waits for its `launch-ack` (`LAUNCH_ACK_TIMEOUT_MS`).
 * Resolves true on a clean ack. False = nothing sent (no running host), or the panel refused / did
 * not answer; then a toast says so unless `opts.toast` is false (the caller keeps its source and retries).
 * The panel creates a new chat, binds it to THIS tab and sends the message.
 */
export function deliverAgentLaunch(
  payload: ChatLaunchMessagePayload,
  opts: { toast?: boolean; launchId?: string } = {}
): Promise<boolean> {
  const post = poster;
  if (!post) return Promise.resolve(false);
  const launchId = post(payload, opts.launchId);
  if (!launchId) {
    if (opts.toast !== false) toast.error("Could not reach the agent panel.");
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => settle(LAUNCH_NO_ACK_MESSAGE), LAUNCH_ACK_TIMEOUT_MS);
    const settle = (error: string | null): void => {
      clearTimeout(timer);
      pendingAcks.delete(launchId);
      if (error !== null && opts.toast !== false) toast.error(error);
      resolve(error === null);
    };
    pendingAcks.set(launchId, settle);
  });
}

/**
 * The ONE dispatcher of every on-canvas agent entry point. Chat enabled: a new chat, the payload queued
 * (the session's auto-send effect delivers it) and the agents panel revealed. Chatless tab: the launch
 * goes to the agent panel (`deliverAgentLaunch`), which does the same there. Local and remote
 * launches stay the same on purpose: neither selects a node nor changes the selection.
 *
 * Reveal the agents section AND open the panel: on a narrow (mobile) layout LeftSidebar unmounts
 * entirely while collapsed, which would leave the queued message stranded with no session mounted to
 * auto-send it.
 */
export async function launchAgentChat(
  payload: ChatLaunchPayload,
  opts: { toast?: boolean; launchId?: string } = {}
): Promise<boolean> {
  if (isChatDisabled()) {
    if (!isCanvasHostRunning()) return false;
    const { text, images } = payload;
    return deliverAgentLaunch({ text, ...(images && images.length > 0 ? { images } : {}) }, opts);
  }
  const chatId = useChatStore.getState().createChat();
  useChatStore.getState().queueLaunchPayload(chatId, payload);
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);
  return true;
}

/** `launchId` generator used by the host's poster. */
export function nextLaunchId(): string {
  return `launch-${Date.now().toString(36)}-${++launchCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
