import { beforeEach, describe, expect, it } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useDrawModeStore } from "@/store/drawModeStore";
import { ALL_TOOLS } from "@/lib/toolDefinitions";
import { key, setupKeyDownHandler } from "./keyboardCommandFixtures";

describe("keyboardCommands — tool-letter dispatch matches toolDefinitions", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler());
    useDrawModeStore.setState({
      activeTool: null,
      isDrawing: false,
      drawStart: null,
      drawCurrent: null,
      pencilPoints: [],
    });
  });

  const toolsWithShortcut = ALL_TOOLS.filter((t) => t.shortcut);

  it("has at least one tool per case this suite pins (cursor, comment, and a plain toggle tool)", () => {
    expect(toolsWithShortcut.some((t) => t.tool === "cursor")).toBe(true);
    expect(toolsWithShortcut.some((t) => t.tool === "comment")).toBe(true);
    expect(toolsWithShortcut.some((t) => t.tool === "frame")).toBe(true);
  });

  // The dispatch goes straight to `useDrawModeStore` for every letter
  // (including "comment", whose "toggleTool" dep type is a hand-maintained
  // union that excludes it) — assert on store state, not the injected
  // `toggleTool` mock. "cursor" behaves differently (it clears the active
  // tool rather than setting one), so it gets its own case below instead of
  // an in-test branch.
  it.each(toolsWithShortcut.filter((t) => t.tool !== "cursor"))(
    "firing the shortcut for $label ($shortcut) activates $tool",
    (def) => {
      expect(useDrawModeStore.getState().activeTool).toBeNull();
      handler(key(`Key${def.shortcut}`));
      expect(useDrawModeStore.getState().activeTool).toBe(def.tool);
      expect(deps.toggleTool).not.toHaveBeenCalled();
    },
  );

  it.each(toolsWithShortcut.filter((t) => t.tool === "cursor"))(
    "firing the shortcut for $label ($shortcut) clears the active tool",
    (def) => {
      // Pre-seed a different active tool so we can observe it being cleared.
      useDrawModeStore.setState({ activeTool: "rect" });
      handler(key(`Key${def.shortcut}`));
      expect(useDrawModeStore.getState().activeTool).toBeNull();
    },
  );

  it("no two tools share the same shortcut letter", () => {
    const letters = toolsWithShortcut.map((t) => t.shortcut);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it("every tool shortcut is a single Key<Letter>-mappable character", () => {
    for (const def of toolsWithShortcut) {
      expect(def.shortcut).toMatch(/^[A-Z]$/);
    }
  });
});
