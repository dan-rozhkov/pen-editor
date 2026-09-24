import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { appendInput, key, keyFrom, setupKeyDownHandler } from "./keyboardCommandFixtures";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("keyboardCommands — I hotkey (eyedropper)", () => {
  let handler: (e: KeyboardEvent) => void;
  const originalEyeDropper = window.EyeDropper;

  beforeEach(() => {
    resetStores();
    seedScene();
    ({ handler } = setupKeyDownHandler());
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

    const input = appendInput();

    handler(keyFrom(input, "KeyI"));
    await flushMicrotasks();

    const node = useSceneStore.getState().nodesById["rect2"];
    expect(node.fill).toBe("#00ff00"); // unchanged — hotkey suppressed while typing
    document.body.removeChild(input);
  });
});
