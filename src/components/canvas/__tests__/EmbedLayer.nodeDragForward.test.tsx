import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

// Three in-flow, vertically-stacked siblings — same shape the sortable-drag
// tests in EmbedLayer.elementPicker.test.tsx use, so a drag on one of them
// WOULD start a sortable reorder if it were the picker's current selection.
// These tests are about the opposite case: none of them is selected first,
// so every drag here is expected to fall through to the embed-NODE-move
// forward instead — see EmbedLayer.tsx's `handlePointerDown`, the
// `isCurrentSelection` gate right above the sortable-drag branch.
function seedEmbed(): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1",
        type: "embed",
        name: "Code",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        htmlContent:
          "<span></span><div>" +
          '<div data-slot="1">One</div>' +
          '<div data-slot="2">Two</div>' +
          '<div data-slot="3">Three</div>' +
          "</div>",
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],
    _cachedTree: null,
  });
}

function pointerEvent(
  type: string,
  init: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
  },
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    ...init,
  });
}

/** Sets up the same `[data-canvas] > canvas` DOM shape production code
 * expects (see `EmbedLayer.tsx`'s `findPixiCanvas`) and renders `EmbedLayer`
 * inside it, mirroring the "forwards a wheel event" test in
 * EmbedLayer.elementPicker.test.tsx. Returns everything a test needs plus a
 * `cleanupCanvas` to remove the extra DOM the default `cleanup()` from
 * testing-library doesn't own. */
function renderWithCanvas() {
  const dataCanvas = document.createElement("div");
  dataCanvas.setAttribute("data-canvas", "");
  document.body.appendChild(dataCanvas);
  const canvas = document.createElement("canvas");
  dataCanvas.appendChild(canvas);
  const mountPoint = document.createElement("div");
  dataCanvas.appendChild(mountPoint);

  const { container } = render(<EmbedLayer />, { container: mountPoint });
  return {
    container,
    canvas,
    cleanupCanvas: () => dataCanvas.remove(),
  };
}

/** Runs `cleanup()` and then flushes a real macrotask, so the module-level
 * `suppressNextEmbedClickAfterNodeDrag` flag's `setTimeout(0)` reset (see
 * `EmbedLayer.tsx`, Finding 1) always finishes before the NEXT test starts —
 * several tests in this file end a started node-drag forward without ever
 * dispatching the trailing click that would consume the flag itself, which
 * is exactly the scenario that reset exists for. Shared by every
 * `afterEach` in this file since the flag is module-scoped, not
 * component-scoped: nothing about unmounting `<EmbedLayer />` resets it. */
async function flushAndCleanup(): Promise<void> {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("<EmbedLayer /> element picker — node-move forward", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(flushAndCleanup);

  it("a drag on an element that is NOT the picker's current selection forwards pointerdown/move/up to the Pixi canvas instead of reordering", () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;

      const forwarded: PointerEvent[] = [];
      canvas.addEventListener("pointerdown", (e) => forwarded.push(e as PointerEvent));
      canvas.addEventListener("pointermove", (e) => forwarded.push(e as PointerEvent));
      canvas.addEventListener("pointerup", (e) => forwarded.push(e as PointerEvent));

      act(() => {
        // item2 was never clicked/selected first — this must NOT start a
        // sortable reorder drag.
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        // Past DRAG_THRESHOLD_PX (3px).
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 80 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 80 }));
      });

      expect(forwarded.map((e) => e.type)).toEqual(["pointerdown", "pointermove", "pointerup"]);
      // The synthetic pointerdown carries the ORIGINAL pointerdown position,
      // not wherever the pointer had drifted to by the time the threshold
      // was crossed — dragController reads this once as its own
      // start-of-drag position.
      expect(forwarded[0].clientX).toBe(10);
      expect(forwarded[0].clientY).toBe(30);
      // The forwarded pointermove/up carry the LIVE position.
      expect(forwarded[1].clientX).toBe(10);
      expect(forwarded[1].clientY).toBe(80);
      expect(forwarded[2].clientX).toBe(10);
      expect(forwarded[2].clientY).toBe(80);

      // Nothing about the embed's own content moved — this was a NODE
      // gesture, not a sortable reorder.
      const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string })
        .htmlContent!;
      expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
      expect(html.indexOf("Two")).toBeLessThan(html.indexOf("Three"));
    } finally {
      cleanupCanvas();
    }
  });

  it("a small move on a not-yet-selected element never forwards anything — it is still just a click", () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;

      const onCanvasPointerDown = vi.fn();
      canvas.addEventListener("pointerdown", onCanvasPointerDown);

      act(() => {
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        // Below DRAG_THRESHOLD_PX — never becomes a drag of any kind.
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 11, clientY: 31 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 11, clientY: 31 }));
        item2.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      });

      expect(onCanvasPointerDown).not.toHaveBeenCalled();
      // The plain click still ran normal selection.
      expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
    } finally {
      cleanupCanvas();
    }
  });

  it("clicking a not-yet-selected element still selects it (rule 1 is unaffected by the node-move gate)", () => {
    const { container, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item3 = host.shadowRoot!.querySelector('[data-slot="3"]')!;

      act(() => {
        item3.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      });

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection?.embedId).toBe("e1");
      expect(selection?.path).toBeTruthy();
    } finally {
      cleanupCanvas();
    }
  });

  it("a self-healed stray node-drag forward tells the canvas via a pointercancel, and does not leave the next gesture confused", () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;
      const item3 = host.shadowRoot!.querySelector('[data-slot="3"]')!;

      act(() => {
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 80 }));
        // pointerup/pointercancel never arrives — the gesture is abandoned.
      });

      const cancelled: PointerEvent[] = [];
      canvas.addEventListener("pointercancel", (e) => cancelled.push(e as PointerEvent));

      act(() => {
        // The very next pointerdown (on a different element) must clean up
        // the abandoned node-drag forward FIRST — see the sortable drag's
        // own self-heal for the established pattern this mirrors.
        item3.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 50 }));
      });

      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].pointerId).toBe(1);
    } finally {
      cleanupCanvas();
    }
  });

  it("a started forward survives stopPicking() (e.g. the forwarded pointerdown itself moved selection elsewhere) and still delivers pointerup to the canvas (Finding 4)", () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;

      const forwarded: PointerEvent[] = [];
      canvas.addEventListener("pointerdown", (e) => forwarded.push(e as PointerEvent));
      canvas.addEventListener("pointermove", (e) => forwarded.push(e as PointerEvent));
      canvas.addEventListener("pointerup", (e) => forwarded.push(e as PointerEvent));

      act(() => {
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        // Past DRAG_THRESHOLD_PX — the forward has started (a synthetic
        // pointerdown just reached the canvas).
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 80 }));
      });
      expect(forwarded.map((e) => e.type)).toEqual(["pointerdown", "pointermove"]);

      // Stand in for the real chain of events: `dragController`'s own
      // `select(hitId)` on that synthetic pointerdown picked some OTHER
      // node, `pickingEmbedId` moved off this embed, and this embed's
      // picking effect tore down — all while the gesture is still
      // physically in progress (button still down).
      act(() => useEmbedPickerStore.getState().stopPicking());

      act(() => {
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 90 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 90 }));
      });

      // The gesture kept going and reached a real end — pointerup included
      // — even though the embed whose effect started it stopped picking
      // partway through.
      expect(forwarded.map((e) => e.type)).toEqual([
        "pointerdown",
        "pointermove",
        "pointermove",
        "pointerup",
      ]);
    } finally {
      cleanupCanvas();
    }
  });
});

describe("<EmbedLayer /> element picker — trailing click after a node-drag forward", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(flushAndCleanup);

  // Code-review finding: the module-level `suppressNextEmbedClickAfterNodeDrag`
  // flag used to reset itself via `queueMicrotask`, but the browser dispatches
  // `pointerup` -> `mouseup` -> `click` as SEPARATE top-level events with a
  // microtask checkpoint running between each (the call stack empties between
  // listener invocations) — so the microtask reset always ran and cleared the
  // flag BEFORE the trailing `click` this gesture is trying to protect ever
  // arrived. `await Promise.resolve()` below reproduces exactly that gap: it
  // is a real microtask checkpoint, standing in for the one the browser's own
  // event pipeline inserts between pointerup and the trailing click.
  it("still suppresses the trailing click after a microtask checkpoint has elapsed", async () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;
      const selectSpy = vi.spyOn(useEmbedPickerStore.getState(), "selectElement");

      act(() => {
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 80 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 80 }));
      });

      // A real microtask checkpoint — see the comment above.
      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        item2.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      });

      expect(selectSpy).not.toHaveBeenCalled();
      expect(useEmbedPickerStore.getState().selection).toBeNull();
      void canvas; // forwarding itself is covered by the tests above
    } finally {
      cleanupCanvas();
      vi.restoreAllMocks();
    }
  });

  it("still clears itself (does not suppress a later, unrelated click) when no trailing click ever arrives", async () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;
      const item3 = host.shadowRoot!.querySelector('[data-slot="3"]')!;

      act(() => {
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 80 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 80 }));
        // No trailing click at all — pointerup released off the Pixi canvas.
      });

      // Let the macrotask reset elapse.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      act(() => {
        item3.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      });

      expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
      void canvas;
    } finally {
      cleanupCanvas();
    }
  });
});

describe("<EmbedLayer /> element picker — handleClick always consumes the node-drag-forward suppress flag (Finding 6)", () => {
  function seedEmbedWithTextLeaf(): void {
    useSceneStore.setState({
      nodesById: {
        e1: {
          id: "e1",
          type: "embed",
          name: "Code",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          htmlContent:
            '<div><span id="txt">Hello</span>' +
            '<div data-slot="2">Two</div>' +
            '<div data-slot="3">Three</div></div>',
        } as unknown as FlatSceneNode,
      },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
      _cachedTree: null,
    });
  }

  beforeEach(() => {
    resetStores();
    seedEmbedWithTextLeaf();
  });
  afterEach(flushAndCleanup);

  // The comment right above `takeSuppressNextEmbedClickAfterNodeDrag()`'s
  // call site claims "both flags are read unconditionally... even when the
  // local one already decides the outcome" — but the
  // `eventTargetsEditingElement` early return used to sit ABOVE that read,
  // so a click landing on the element currently being inline-edited left
  // the module-level flag stuck pending, ready to wrongly suppress whatever
  // click read it next — even one on a wholly unrelated embed.
  it("clicking the actively-edited element still consumes a pending suppress flag, so the NEXT unrelated click is not wrongly swallowed", () => {
    const { container, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const span = host.shadowRoot!.querySelector("#txt")!;
      const item2 = host.shadowRoot!.querySelector('[data-slot="2"]')!;
      const item3 = host.shadowRoot!.querySelector('[data-slot="3"]')!;

      // 1) A node-drag-forward gesture that crosses the threshold — this
      // arms the module-level suppress flag — WITHOUT its own trailing
      // click ever being dispatched, so the flag is still pending true
      // afterwards.
      act(() => {
        item2.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 80 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 80 }));
      });

      // 2) Enter inline text-edit mode on an unrelated element.
      act(() => {
        span.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }),
        );
      });
      expect(useEmbedPickerStore.getState().editingEmbedId).toBe("e1");

      // 3) A click landing on the actively-edited element (native caret
      // placement) — this is the branch that used to return before ever
      // reading the pending flag.
      act(() => {
        span.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      });

      // 4) A genuine, unrelated later click must select normally — it must
      // NOT be swallowed by a suppress flag that step 3 should already have
      // consumed.
      const selectSpy = vi.spyOn(useEmbedPickerStore.getState(), "selectElement");
      // `vi.spyOn` on a property that's already a spy (step 2's
      // `beginElementEdit` -> `selectElement` call, above) returns the SAME
      // spy rather than a fresh one — clear its call history so this
      // assertion counts only step 4's click, not every `selectElement` call
      // since whenever this method was first spied on in this file.
      selectSpy.mockClear();
      act(() => {
        item3.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      });

      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(useEmbedPickerStore.getState().selection?.tagName).toBe("div");
    } finally {
      cleanupCanvas();
      vi.restoreAllMocks();
    }
  });
});

describe("<EmbedLayer /> element picker — node-move forward is gated during inline text edit", () => {
  beforeEach(() => {
    resetStores();
    useSceneStore.setState({
      nodesById: {
        e1: {
          id: "e1",
          type: "embed",
          name: "Code",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          htmlContent: "<div><span>Editable text</span><button id='other'>Other</button></div>",
        } as unknown as FlatSceneNode,
      },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
      _cachedTree: null,
    });
  });
  afterEach(flushAndCleanup);

  it("a pointerdown-then-drag INSIDE the element currently being edited never reaches the node-move forward", () => {
    const { container, canvas, cleanupCanvas } = renderWithCanvas();
    try {
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const span = host.shadowRoot!.querySelector("span")!;

      act(() => {
        span.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }),
        );
      });
      expect(useEmbedPickerStore.getState().editingEmbedId).toBe("e1");

      const onCanvasPointerDown = vi.fn();
      canvas.addEventListener("pointerdown", onCanvasPointerDown);

      act(() => {
        // A pointerdown+drag landing on the element being edited is native
        // caret/selection behaviour — `handlePointerDown` returns before
        // ANY branch decision (sortable vs. node-move) for it.
        span.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 }));
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 10, clientY: 60 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 10, clientY: 60 }));
      });

      expect(onCanvasPointerDown).not.toHaveBeenCalled();
      // Still editing — none of this was interpreted as leaving edit mode.
      expect(useEmbedPickerStore.getState().editingEmbedId).toBe("e1");
    } finally {
      cleanupCanvas();
    }
  });
});
