import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { ALL_TOOLS } from "@/lib/toolDefinitions";

function makeDeps(): KeyDownHandlerDeps {
  return {
    dimensions: { width: 800, height: 600 },
    setIsSpacePressed: vi.fn(),
    setIsPanning: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    moveNode: vi.fn(),
    groupNodes: vi.fn(() => null),
    ungroupNodes: vi.fn(() => []),
    wrapInAutoLayoutFrame: vi.fn(() => null),
    booleanOperation: vi.fn(() => null),
    restoreSnapshot: vi.fn(),
    saveHistory: vi.fn(),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
    fitToContent: vi.fn(),
    toggleTool: vi.fn(),
    cancelDrawing: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    copyStyleSelection: vi.fn(),
    pasteStyleSelection: vi.fn(),
    copyAsCss: vi.fn(),
    copyAsSvg: vi.fn(),
  };
}

function key(code: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...opts });
}

describe("keyboardCommands — tool-letter dispatch matches toolDefinitions", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
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

  it.each(toolsWithShortcut)(
    "firing the shortcut for $label ($shortcut) activates $tool",
    (def) => {
      // The dispatch now goes straight to `useDrawModeStore` for every
      // letter (including "comment", whose "toggleTool" dep type is a
      // hand-maintained union that excludes it) — assert on store state,
      // not the injected `toggleTool` mock.
      if (def.tool === "cursor") {
        // Pre-seed a different active tool so we can observe it being cleared.
        useDrawModeStore.setState({ activeTool: "rect" });
        handler(key(`Key${def.shortcut}`));
        expect(useDrawModeStore.getState().activeTool).toBeNull();
        return;
      }

      expect(useDrawModeStore.getState().activeTool).toBeNull();
      handler(key(`Key${def.shortcut}`));
      expect(useDrawModeStore.getState().activeTool).toBe(def.tool);
      expect(deps.toggleTool).not.toHaveBeenCalled();
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
