import { beforeEach, describe, expect, it } from "vitest";

import { PANEL_COLLAPSED_KEY, isPanelToggleShortcut, loadPanelCollapsed, savePanelCollapsed } from "@/lib/workspace/panelState";

describe("panelState", () => {
  beforeEach(() => window.localStorage.removeItem(PANEL_COLLAPSED_KEY));

  it("starts expanded and remembers the choice", () => {
    expect(loadPanelCollapsed()).toBe(false);
    savePanelCollapsed(true);
    expect(loadPanelCollapsed()).toBe(true);
    savePanelCollapsed(false);
    expect(loadPanelCollapsed()).toBe(false);
  });

  it.each([
    [{ code: "KeyB", metaKey: true, altKey: true }, true],
    [{ code: "KeyB", ctrlKey: true, altKey: true }, true],
    [{ code: "KeyB", metaKey: true }, false],
    [{ code: "KeyB", altKey: true }, false],
    [{ code: "KeyB", metaKey: true, altKey: true, shiftKey: true }, false],
    [{ code: "KeyC", metaKey: true, altKey: true }, false],
  ])("isPanelToggleShortcut(%o) is %s", (init, expected) => {
    expect(isPanelToggleShortcut(new KeyboardEvent("keydown", init))).toBe(expected);
  });
});
