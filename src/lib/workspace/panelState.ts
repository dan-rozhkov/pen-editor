// Whether the agent panel of /workspace is collapsed. A preference of this browser, shared by its windows.

export const PANEL_COLLAPSED_KEY = "pen.workspace.panelCollapsed.v1";

export function loadPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePanelCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(PANEL_COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(PANEL_COLLAPSED_KEY);
  } catch {
    /* storage blocked: the choice lasts until a reload */
  }
}

/** Cmd/Ctrl+Alt+B, the desktop shortcut. By key code: Alt changes `key` on macOS. */
export function isPanelToggleShortcut(e: KeyboardEvent): boolean {
  return e.code === "KeyB" && e.altKey && !e.shiftKey && (e.metaKey || e.ctrlKey);
}
