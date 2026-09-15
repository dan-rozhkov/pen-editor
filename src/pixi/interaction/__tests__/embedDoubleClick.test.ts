import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Application, Container } from "pixi.js";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { setupPixiInteraction } from "../pixiInteractionCore";

// findFrameLabelAtPoint (checked first on every pointerdown, and again in
// handleDblClick) measures label text via pixi's CanvasTextMetrics, which
// needs a real CanvasRenderingContext2D global happy-dom doesn't provide.
// Stub it deterministically, same workaround as touchController.test.ts.
vi.mock("@/pixi/frameLabelUtils", () => ({
  truncateLabelToWidth: (text: string) => text,
  measureLabelTextWidth: (text: string) => text.length * 8,
}));

/**
 * `setupPixiInteraction` only ever reads `app.canvas` — `viewport`/
 * `sceneRoot` are immediately `void`-ed inside it — so a real PixiJS
 * `Application` (which would need a WebGL context happy-dom doesn't have)
 * is unnecessary here. A bare canvas element plus two dummy containers
 * satisfy the signature.
 */
function setupInteractionOnFakeCanvas(): { canvas: HTMLCanvasElement; cleanup: () => void } {
  const canvas = document.createElement("canvas");
  const app = { canvas } as unknown as Application;
  const fakeContainer = {} as Container;
  const cleanup = setupPixiInteraction(app, fakeContainer, fakeContainer);
  return { canvas, cleanup };
}

function seedEmbedScene(): void {
  const embed: FlatSceneNode = {
    id: "embed1",
    type: "embed",
    name: "Embed",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    htmlContent: "<div>hi</div>",
  } as unknown as FlatSceneNode & EmbedNode;

  useSceneStore.setState({
    nodesById: { embed1: embed },
    parentById: { embed1: null },
    childrenById: {},
    rootIds: ["embed1"],
    _cachedTree: null,
  });
}

function click(canvas: HTMLCanvasElement, x: number, y: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: y, bubbles: true }),
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { button: 0, clientX: x, clientY: y, bubbles: true }),
  );
}

describe("double-click on an embed node", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    seedEmbedScene();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("selects the embed alone and starts the element picker, instead of inline edit", () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    // Two rapid clicks inside the embed's bounds (0,0..100,100) qualify as a
    // double-click (see DOUBLE_CLICK_TIME_MS/CLICK_MOVE_THRESHOLD_PX).
    click(setup.canvas, 50, 50);
    click(setup.canvas, 50, 50);

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("embed1");
    expect(useSelectionStore.getState().selectedIds).toEqual(["embed1"]);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });
});
