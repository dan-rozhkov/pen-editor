import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useCanvasKeyboardShortcuts } from "../useCanvasKeyboardShortcuts";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { key, makeKeyDownDeps, seedSelectedFrame, setupKeyDownHandler } from "./keyboardCommandFixtures";

// With the browser surface in the work area the canvas is hidden, so none of
// its shortcuts may touch the scene.
describe("canvas shortcuts while another surface is active", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler("edit"));
    seedSelectedFrame();
    useSurfaceStore.setState({ activeSurfaceId: "browser" });
  });

  afterEach(() => {
    useSurfaceStore.setState({ activeSurfaceId: "canvas" });
  });

  it("ignores delete, undo, group and copy", () => {
    handler(key("Delete"));
    handler(key("Backspace"));
    handler(key("KeyZ", { metaKey: true }));
    handler(key("KeyG", { metaKey: true }));
    handler(key("KeyC", { metaKey: true }));
    expect(deps.deleteNode).not.toHaveBeenCalled();
    expect(deps.undo).not.toHaveBeenCalled();
    expect(deps.groupNodes).not.toHaveBeenCalled();
    expect(deps.copySelection).not.toHaveBeenCalled();
  });

  it("does not start present mode", () => {
    handler(key("Enter", { metaKey: true }));
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  it("still runs canvas shortcuts when the UI is hidden: the browser view is not shown then", () => {
    useUIVisibilityStore.setState({ isUIHidden: true });
    try {
      handler(key("Delete"));
      expect(deps.deleteNode).toHaveBeenCalledWith("F");
    } finally {
      useUIVisibilityStore.setState({ isUIHidden: false });
    }
  });

  it("resumes on the canvas surface", () => {
    useSurfaceStore.setState({ activeSurfaceId: "canvas" });
    handler(key("Delete"));
    expect(deps.deleteNode).toHaveBeenCalledWith("F");
  });
});

describe("useCanvasKeyboardShortcuts clipboard events while another surface is active", () => {
  afterEach(() => {
    useSurfaceStore.setState({ activeSurfaceId: "canvas" });
  });

  it.each([
    ["canvas", 1],
    ["browser", 0],
  ] as const)("on the %s surface a menu cut deletes %i node(s)", (surfaceId, deletions) => {
    const deps = makeKeyDownDeps();
    seedSelectedFrame();
    useSurfaceStore.setState({ activeSurfaceId: surfaceId });
    const { unmount } = renderHook(() =>
      useCanvasKeyboardShortcuts({
        ...deps,
        isMiddleMouseDown: false,
        addNode: vi.fn(),
        addChildToFrame: vi.fn(),
        copyNodes: vi.fn(),
      }),
    );
    window.dispatchEvent(new Event("pen-editor:cut"));
    unmount();
    expect(deps.deleteNode).toHaveBeenCalledTimes(deletions);
  });
});
