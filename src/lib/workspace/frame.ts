// Detects a page framed by the in-page tab shell (`/workspace`). Only such frames get the
// browser-side canvas store; a plain top-level `/app` on the web stays untouched.

import { appHref } from "@/lib/auth/paths";

export const WORKSPACE_PATH = "/workspace";

/** Pathname of the workspace route under the configured base, without a trailing slash. */
export function workspacePathname(): string {
  return appHref(WORKSPACE_PATH);
}

/** true when this window is an iframe of a same-origin `/workspace` page. Never throws. */
export function isWorkspaceFrame(): boolean {
  try {
    if (typeof window === "undefined" || window.parent === window) return false;
    const parent = window.parent;
    if (parent.location.origin !== window.location.origin) return false;
    const path = parent.location.pathname.replace(/\/+$/, "") || "/";
    return path === workspacePathname();
  } catch {
    return false;
  }
}

const TAB_PATHS = ["/app", "/doc", "/workflow", "/settings", "/trace"];

/** Routes allowed inside a workspace tab frame (router-relative path). */
export function isTabPath(path: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  return TAB_PATHS.some((t) => p === t || (t === "/trace" && p.startsWith("/trace/")));
}
