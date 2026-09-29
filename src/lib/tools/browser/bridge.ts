import type { PenDesktopApi } from "@/lib/desktopBridge";
import { cloudBrowserBridge, getCloudBrowserBridge } from "@/lib/cloudBrowser";

export type BrowserBridge = NonNullable<PenDesktopApi["browser"]>;

/**
 * The bridge every browse_* handler talks to: the Electron shell's own
 * `window.penDesktop.browser` when present (byte-identical desktop
 * behavior), otherwise the cloud bridge that forwards to the backend
 * (pen-editor-backend docs/specs/2026-09-29-cloud-browser-steel-design.md).
 * `chatId` binds the cloud bridge to the calling chat's session; without it
 * the chat last set via `setCloudBrowserChat` is used.
 */
export function getBrowserBridge(chatId?: string): BrowserBridge | undefined {
  const desktop = window.penDesktop?.browser;
  if (desktop) return desktop;
  return chatId ? getCloudBrowserBridge(chatId) : cloudBrowserBridge;
}

/**
 * The single predicate for "this client has its own built-in browser": the
 * Electron shell exposes `window.penDesktop.browser`. A `penDesktop` without
 * `.browser` (older shell) falls through to the cloud browser, so bridge
 * selection, the live-view panel and the request capability must all use this.
 */
export function isDesktopBrowserAvailable(): boolean {
  return Boolean(window.penDesktop?.browser);
}
