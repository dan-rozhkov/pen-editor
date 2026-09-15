import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Application, Container } from "pixi.js";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { setupPixiInteraction } from "../pixiInteractionCore";

// findFrameLabelAtPoint measures label text via pixi's CanvasTextMetrics,
// which needs a real CanvasRenderingContext2D global happy-dom doesn't
// provide. Same stub as embedDoubleClick.test.ts.
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

function seedNodeScene(): void {
  const node: FlatSceneNode = {
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
    nodesById: { embed1: node },
    parentById: { embed1: null },
    childrenById: {},
    rootIds: ["embed1"],
    _cachedTree: null,
  });
}

/** happy-dom's `new PointerEvent(...)` is always untrusted (`isTrusted ===
 * false`), unlike a real browser dispatching an OS-originated event. The
 * fallback's arm/no-arm behavior branches on `isTrusted`, so the "real
 * gesture" test cases fake it with a property override — this is the one
 * place in this file that needs to. */
function trustedPointerEvent(
  type: string,
  init: PointerEventInit,
): PointerEvent {
  const ev = new PointerEvent(type, init);
  Object.defineProperty(ev, "isTrusted", { value: true });
  return ev;
}

describe("window pointer fallback (embed-picker host stealing a gesture)", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    seedNodeScene();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("regression: a drag that started on the canvas still ends when move/up land on a different element", () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    // Stand-in for the embed's DOM host, which `pointer-events: auto`
    // flips under the cursor mid-gesture (see the doc comment in
    // pixiInteractionCore.ts).
    const host = document.createElement("div");
    document.body.appendChild(host);

    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    // Past CLICK_MOVE_THRESHOLD_PX (5px) so dragController commits to a drag.
    // `buttons: 1` mirrors a real drag (primary button still held) — without
    // it this move would look identical to the "button already released"
    // case the self-heal fix (finding 1) now treats specially.
    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 70,
        clientY: 80,
        buttons: 1,
        bubbles: true,
      }),
    );
    host.dispatchEvent(
      trustedPointerEvent("pointerup", {
        button: 0,
        clientX: 70,
        clientY: 80,
        bubbles: true,
      }),
    );

    const draggedNode = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(draggedNode.x).toBe(20);
    expect(draggedNode.y).toBe(30);

    // Before the fix: the gesture never ended, so a later canvas
    // pointermove would keep moving the node. After the fix it must be a
    // no-op — the drag already ended at the host pointerup above.
    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 90,
        clientY: 90,
        bubbles: true,
      }),
    );

    const afterExtraMove = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(afterExtraMove.x).toBe(20);
    expect(afterExtraMove.y).toBe(30);
  });

  it("no double-processing: a normal canvas-targeted drag moves the node by exactly the pointer delta", () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 65,
        clientY: 55,
        bubbles: true,
      }),
    );
    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerup", {
        button: 0,
        clientX: 65,
        clientY: 55,
        bubbles: true,
      }),
    );

    const node = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    // If the window listener double-processed the bubbled pointermove/up,
    // the delta would be doubled (30/10 instead of 15/5).
    expect(node.x).toBe(15);
    expect(node.y).toBe(5);
  });

  it("synthetic gesture untouched: an untrusted pointerdown never arms the window fallback", () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    const host = document.createElement("div");
    document.body.appendChild(host);

    // happy-dom's `new PointerEvent` is untrusted by default — exactly what
    // EmbedLayer's `forwardPointerEvent` produces for its own synthetic
    // gesture.
    setup.canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 90,
        clientY: 90,
        bubbles: true,
      }),
    );

    const node = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(node.x).toBe(0);
    expect(node.y).toBe(0);
  });

  it("cleanup: after teardown runs mid-gesture, later window-level pointer events are ignored", async () => {
    const setup = setupInteractionOnFakeCanvas();

    const host = document.createElement("div");
    document.body.appendChild(host);

    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 70,
        clientY: 80,
        buttons: 1,
        bubbles: true,
      }),
    );

    // dragController coalesces position writes to one per animation frame
    // (see commitDragPositions in dragController.ts) — wait for it so the
    // pre-cleanup move is actually committed before we tear down.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const nodeBeforeCleanup = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(nodeBeforeCleanup.x).toBe(20);
    expect(nodeBeforeCleanup.y).toBe(30);

    // Tear down mid-gesture (e.g. PixiCanvas unmounting).
    setup.cleanup();

    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // The post-cleanup pointermove on the host must not be picked up at all
    // (no window listener left) — the node stays where the pre-cleanup move
    // left it.
    const node = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(node.x).toBe(20);
    expect(node.y).toBe(30);
  });

  it("finding 1: a lost pointerup self-heals via buttons===0, and later window moves are then ignored", async () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    const host = document.createElement("div");
    document.body.appendChild(host);

    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    // A real move first, so the drag is unambiguously in flight (dragController
    // coalesces the commit to the next animation frame — awaited below).
    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 70,
        clientY: 80,
        buttons: 1,
        bubbles: true,
      }),
    );

    // The button was released somewhere this listener never saw (outside the
    // window, over browser chrome) — the only trace of that is `buttons`
    // already reporting 0 on the next event we DO see. This must be treated
    // as the end of the gesture, not a move: no further `handlePointerMove`
    // call means the node must NOT jump to this event's (far away) position
    // — it stays at the last real move's delta.
    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 500,
        clientY: 500,
        buttons: 0,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const nodeAfterSelfHeal = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(nodeAfterSelfHeal.x).toBe(20);
    expect(nodeAfterSelfHeal.y).toBe(30);

    // The self-heal must also disarm the fallback — a later move (even with
    // the button legitimately held, as a brand new unrelated gesture would
    // report) must not be picked up by a listener that should already be gone.
    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        clientX: 90,
        clientY: 90,
        buttons: 1,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const nodeAfterExtraMove = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(nodeAfterExtraMove.x).toBe(20);
    expect(nodeAfterExtraMove.y).toBe(30);
  });

  it("finding 2: a pointerup carrying a different pointerId does not end/disarm the gesture; the matching one does", () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    const host = document.createElement("div");
    document.body.appendChild(host);

    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    // A foreign pointer's pointerup (e.g. a finger touching the screen
    // elsewhere on a touch-capable machine) reaches `window` while the real
    // gesture is still in flight — it must be ignored entirely.
    host.dispatchEvent(
      trustedPointerEvent("pointerup", {
        pointerId: 999,
        button: 0,
        clientX: 9999,
        clientY: 9999,
        bubbles: true,
      }),
    );

    // The fallback must still be armed for pointerId 1 — a matching move
    // still reaches the drag.
    host.dispatchEvent(
      trustedPointerEvent("pointermove", {
        pointerId: 1,
        clientX: 70,
        clientY: 80,
        buttons: 1,
        bubbles: true,
      }),
    );

    // The matching pointerId's pointerup ends the gesture normally.
    host.dispatchEvent(
      trustedPointerEvent("pointerup", {
        pointerId: 1,
        button: 0,
        clientX: 70,
        clientY: 80,
        bubbles: true,
      }),
    );

    const node = useSceneStore.getState().nodesById.embed1 as FlatSceneNode;
    expect(node.x).toBe(20);
    expect(node.y).toBe(30);
  });

  it("finding 3: a pointerup that targets a non-canvas element does not seed a click into the double-click detector", () => {
    const setup = setupInteractionOnFakeCanvas();
    cleanup = setup.cleanup;

    const host = document.createElement("div");
    document.body.appendChild(host);

    // First "click": down on the canvas, up on the host (within
    // CLICK_MOVE_THRESHOLD_PX) — the embed-picker-host-steals-the-gesture
    // scenario, but ending in a click rather than a drag.
    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    host.dispatchEvent(
      trustedPointerEvent("pointerup", {
        button: 0,
        clientX: 51,
        clientY: 51,
        bubbles: true,
      }),
    );

    // A single genuine click on the canvas at roughly the same point. If the
    // host-targeted pointerup above had wrongly registered as click #1, this
    // would be recognized as click #2 and promoted to a double-click,
    // starting the embed picker. With the fix it must be treated as an
    // unpaired first click.
    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerdown", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    setup.canvas.dispatchEvent(
      trustedPointerEvent("pointerup", {
        button: 0,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    // The lone genuine click above still selects the embed via ordinary
    // pointerdown handling — only the double-click-triggered picker must be
    // absent.
    expect(useSelectionStore.getState().selectedIds).toEqual(["embed1"]);
  });
});
