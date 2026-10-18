/**
 * The single predicate for "this client has its own built-in browser": the
 * Electron shell exposes `window.penDesktop.browser`. A `penDesktop` without
 * `.browser` (older shell) falls through to the cloud browser, so bridge
 * selection, the live-view panel and the request capability must all use this.
 */
export function isDesktopBrowserAvailable(): boolean {
  return Boolean(window.penDesktop?.browser);
}
