import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";

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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("keyboardCommands — I hotkey (eyedropper)", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;
  const originalEyeDropper = window.EyeDropper;

  beforeEach(() => {
    resetStores();
    seedScene();
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  afterEach(() => {
    window.EyeDropper = originalEyeDropper;
  });

  it("samples a color and applies it as fill to the selected node", async () => {
    class FakeEyeDropper {
      open() {
        return Promise.resolve({ sRGBHex: "#ff0000" });
      }
    }
    window.EyeDropper = FakeEyeDropper as unknown as typeof window.EyeDropper;
    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);

    handler(key("KeyI"));
    await flushMicrotasks();

    const node = useSceneStore.getState().nodesById["rect2"];
    expect(node.fills?.[0]).toMatchObject({ type: "solid", color: "#ff0000" });
  });

  it("does nothing when nothing is selected", async () => {
    const openSpy = vi.fn(() => Promise.resolve({ sRGBHex: "#ff0000" }));
    class FakeEyeDropper {
      open() {
        return openSpy();
      }
    }
    const ctorSpy = vi.fn((...args: unknown[]) => new FakeEyeDropper(...(args as [])));
    window.EyeDropper = ctorSpy as unknown as typeof window.EyeDropper;
    useSelectionStore.setState({ selectedIds: [] } as never);

    handler(key("KeyI"));
    await flushMicrotasks();

    expect(openSpy).not.toHaveBeenCalled();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the browser has no EyeDropper support", async () => {
    delete (window as { EyeDropper?: unknown }).EyeDropper;
    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);

    expect(() => handler(key("KeyI"))).not.toThrow();
    await flushMicrotasks();

    const node = useSceneStore.getState().nodesById["rect2"];
    expect(node.fill).toBe("#00ff00"); // unchanged
  });

  it("makes no change when the pick is cancelled", async () => {
    class FakeEyeDropper {
      open() {
        return Promise.reject(new Error("cancelled"));
      }
    }
    window.EyeDropper = FakeEyeDropper as unknown as typeof window.EyeDropper;
    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);

    handler(key("KeyI"));
    await flushMicrotasks();

    const node = useSceneStore.getState().nodesById["rect2"];
    expect(node.fill).toBe("#00ff00"); // unchanged
  });

  it("does not fire while typing in an input", async () => {
    class FakeEyeDropper {
      open() {
        return Promise.resolve({ sRGBHex: "#ff0000" });
      }
    }
    window.EyeDropper = FakeEyeDropper as unknown as typeof window.EyeDropper;
    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);

    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = new KeyboardEvent("keydown", { code: "KeyI", key: "KeyI", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: input });

    handler(event);
    await flushMicrotasks();

    const node = useSceneStore.getState().nodesById["rect2"];
    expect(node.fill).toBe("#00ff00"); // unchanged — hotkey suppressed while typing
    document.body.removeChild(input);
  });
});
