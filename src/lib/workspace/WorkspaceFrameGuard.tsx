import { useEffect } from "react";
import { useLocation } from "react-router";
import { stripBase } from "@/lib/auth/paths";
import { WORKSPACE_PATH, isTabPath, isWorkspaceFrame, workspacePathname } from "./frame";

/**
 * sessionStorage flag: the top window left a workspace for a non-tab page (sign-in, account).
 * The value is the time it was set; it is ignored and removed after `RETURN_FLAG_TTL_MS`, and
 * cleared on arrival at /workspace, so an abandoned round trip cannot outlive itself.
 */
export const WORKSPACE_RETURN_KEY = "pen.workspace.return";
export const RETURN_FLAG_TTL_MS = 15 * 60 * 1000;

function setReturnFlag(): void {
  try {
    window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now()));
  } catch {
    /* storage blocked: no round trip back */
  }
}

function clearReturnFlag(): void {
  try {
    window.sessionStorage.removeItem(WORKSPACE_RETURN_KEY);
  } catch {
    /* ignore */
  }
}

/** true (and the flag cleared) when a fresh flag was set; a stale or malformed one is removed and ignored. */
function takeReturnFlag(): boolean {
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_RETURN_KEY);
    if (raw === null) return false;
    window.sessionStorage.removeItem(WORKSPACE_RETURN_KEY);
    const at = Number(raw);
    const age = Date.now() - at;
    return Number.isFinite(at) && age >= 0 && age <= RETURN_FLAG_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Inside a workspace frame, any route that is not a tab surface (sign-in, OAuth consent,
 * account, the showcase) leaves the frame: external OAuth redirects cannot run in an iframe.
 * The top window remembers that it left a workspace; the next tab route it lands on (after
 * sign-in or an account visit) goes back to the workspace.
 */
export function WorkspaceFrameGuard(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    const path = stripBase(pathname);
    if (isWorkspaceFrame()) {
      if (isTabPath(path)) return;
      if (path !== "/") setReturnFlag();
      try {
        window.top?.location.replace(window.location.href);
      } catch {
        /* top is not reachable: stay in the frame */
      }
      return;
    }
    // Top window (not framed, not the desktop shell).
    if (window.parent !== window || window.penDesktop) return;
    if (path === WORKSPACE_PATH) {
      clearReturnFlag();
      return;
    }
    if (isTabPath(path) && takeReturnFlag()) window.location.replace(workspacePathname());
  }, [pathname]);
  return null;
}
