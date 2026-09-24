import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resolveElementPath } from "@/lib/embedElementPicker";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import {
  seedEmbedNode,
  embedPointerEvent,
  renderEmbedLayerWithCanvas,
  THREE_SLOT_HTML,
} from "./embedLayerFixtures";

function seedEmbed(htmlContent = "<div><button id='cta'>Buy</button></div>"): void {
  seedEmbedNode(htmlContent);
}

describe("<EmbedLayer /> element picker interaction", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => cleanup());

  it("clicking an element inside the embed's shadow content records a rooted selection with an html snapshot", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => {
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    const selection = useEmbedPickerStore.getState().selection;
    expect(selection?.embedId).toBe("e1");
    expect(selection?.tagName).toBe("button");
    expect(selection?.path).toBeTruthy();
  });

  it("clicking the shadow host itself (outside the shadow root's subtree) does not record a selection", () => {
    // Regression for resolvePickableElement not checking containment: a
    // sub-pixel gap around the overlay host rect, or a pointer event firing
    // before htmlContent has mounted, can deliver the host element itself
    // as event.composedPath()[0] — which sits OUTSIDE root (root is the
    // shadow root), not inside it.
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;

    act(() => {
      host.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("hovering the shadow host itself does not set a hovered path", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;

    act(() => {
      host.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });

    expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();
  });

  it("throttles repeated pointermove events over the same element — only the first writes to the store", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const setHoveredPath = vi.spyOn(useEmbedPickerStore.getState(), "setHoveredPath");

    act(() => {
      button.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));
      button.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));
      button.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));
    });

    expect(setHoveredPath).toHaveBeenCalledTimes(1);
  });

  it("swallows mousedown inside the embed while picking, so the embed's own handler never fires", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const innerHandler = vi.fn();
    button.addEventListener("mousedown", innerHandler);

    act(() => {
      button.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(innerHandler).not.toHaveBeenCalled();
  });

  it("forwards a wheel event from the host to the underlying Pixi canvas while picking", () => {
    // Mirrors runtime DOM shape: `[data-canvas]` hosts both the Pixi
    // `<canvas>` (a sibling, not an ancestor, of the embed host) and — as a
    // separate child — the React root that renders `EmbedLayer`/its hosts.
    // Passing `dataCanvas` itself as the render `container` would work too,
    // except RTL clears a container's existing children on mount, which
    // would wipe the `<canvas>` appended before render.
    const dataCanvas = document.createElement("div");
    dataCanvas.setAttribute("data-canvas", "");
    document.body.appendChild(dataCanvas);
    const canvas = document.createElement("canvas");
    dataCanvas.appendChild(canvas);
    const onCanvasWheel = vi.fn();
    canvas.addEventListener("wheel", onCanvasWheel);
    const mountPoint = document.createElement("div");
    dataCanvas.appendChild(mountPoint);

    // happy-dom's WheelEvent constructor never applies the MouseEvent-
    // inherited init fields (ctrlKey/clientX/clientY read back `undefined`
    // regardless of what's passed in), so the forwarded event's own
    // properties can't be trusted to check a faithful field-by-field copy.
    // Spy on the constructor instead and inspect the init dict EmbedLayer
    // actually builds.
    const RealWheelEvent = globalThis.WheelEvent;
    const ctorSpy = vi.fn(function (this: unknown, type: string, init?: WheelEventInit) {
      return new RealWheelEvent(type, init);
    });
    vi.stubGlobal("WheelEvent", ctorSpy as unknown as typeof WheelEvent);

    try {
      const { container } = render(<EmbedLayer />, { container: mountPoint });
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const wheelEvent = new RealWheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 40,
        deltaX: 5,
      });
      // Force the MouseEvent-inherited fields onto the instance directly —
      // that assignment does work, unlike passing them through the
      // constructor — so EmbedLayer's own `e.ctrlKey`/`e.clientX` reads see
      // the intended values.
      Object.assign(wheelEvent, { ctrlKey: true, clientX: 12, clientY: 34 });

      act(() => {
        host.dispatchEvent(wheelEvent);
      });

      expect(onCanvasWheel).toHaveBeenCalledTimes(1);
      expect(ctorSpy).toHaveBeenCalledTimes(1);
      const [type, init] = ctorSpy.mock.calls[0];
      expect(type).toBe("wheel");
      expect(init?.deltaY).toBe(40);
      expect(init?.deltaX).toBe(5);
      expect(init?.ctrlKey).toBe(true);
      expect(init?.clientX).toBe(12);
      expect(init?.clientY).toBe(34);
    } finally {
      vi.unstubAllGlobals();
      dataCanvas.remove();
    }
  });

  describe("multitouch forwarding (Finding 3)", () => {
    function makeTouch(target: Element, id: number, clientX = 0, clientY = 0): Touch {
      return new Touch({ identifier: id, target, clientX, clientY });
    }

    function touchEvent(
      type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
      touches: Touch[],
      changedTouches: Touch[] = touches,
    ): TouchEvent {
      return new TouchEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches,
      });
    }

    it("forwards a two-finger touchstart to the Pixi canvas instead of letting the picker treat it as a tap", () => {
      const { container, canvas, cleanupCanvas } = renderEmbedLayerWithCanvas();
      try {
        act(() => useEmbedPickerStore.getState().startPicking("e1"));
        const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
        const button = host.shadowRoot!.querySelector("button")!;

        const onCanvasTouchStart = vi.fn();
        canvas.addEventListener("touchstart", onCanvasTouchStart);

        act(() => {
          host.dispatchEvent(
            touchEvent("touchstart", [makeTouch(button, 1, 10, 10), makeTouch(button, 2, 20, 20)]),
          );
        });

        expect(onCanvasTouchStart).toHaveBeenCalledTimes(1);
        const forwarded = onCanvasTouchStart.mock.calls[0][0] as TouchEvent;
        expect(forwarded.touches).toHaveLength(2);
      } finally {
        cleanupCanvas();
      }
    });

    it("never forwards a single-finger touch — that stays the picker's own tap-to-select", () => {
      const { container, canvas, cleanupCanvas } = renderEmbedLayerWithCanvas();
      try {
        act(() => useEmbedPickerStore.getState().startPicking("e1"));
        const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
        const button = host.shadowRoot!.querySelector("button")!;

        const onCanvasTouchStart = vi.fn();
        canvas.addEventListener("touchstart", onCanvasTouchStart);

        act(() => {
          host.dispatchEvent(touchEvent("touchstart", [makeTouch(button, 1, 10, 10)]));
        });

        expect(onCanvasTouchStart).not.toHaveBeenCalled();
      } finally {
        cleanupCanvas();
      }
    });

    it("keeps forwarding touchmove/touchend through to the end of a gesture that started multitouch, even after a finger lifts and the count drops below 2", () => {
      const { container, canvas, cleanupCanvas } = renderEmbedLayerWithCanvas();
      try {
        act(() => useEmbedPickerStore.getState().startPicking("e1"));
        const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
        const button = host.shadowRoot!.querySelector("button")!;

        const forwarded: string[] = [];
        canvas.addEventListener("touchstart", () => forwarded.push("touchstart"));
        canvas.addEventListener("touchmove", () => forwarded.push("touchmove"));
        canvas.addEventListener("touchend", () => forwarded.push("touchend"));

        const t1 = makeTouch(button, 1, 10, 10);
        const t2 = makeTouch(button, 2, 20, 20);

        act(() => {
          // Two fingers down — starts the multitouch forward.
          host.dispatchEvent(touchEvent("touchstart", [t1, t2]));
          // One finger lifts — the remaining touch list has only 1 entry —
          // but the gesture already started as multitouch, so this must
          // still forward rather than silently stopping.
          host.dispatchEvent(touchEvent("touchend", [t1], [t2]));
          // The last finger lifts.
          host.dispatchEvent(touchEvent("touchend", [], [t1]));
        });

        expect(forwarded).toEqual(["touchstart", "touchend", "touchend"]);

        // The series is over (0 touches) — the NEXT touchstart is judged
        // fresh: a single finger must not forward again.
        forwarded.length = 0;
        act(() => {
          host.dispatchEvent(touchEvent("touchstart", [makeTouch(button, 3, 5, 5)]));
        });
        expect(forwarded).toEqual([]);
      } finally {
        cleanupCanvas();
      }
    });
  });
});

describe("<EmbedLayer /> element picker — drag to reorder", () => {
  // Three in-flow (vertically-stacked) siblings, no ids so buildElementPath
  // falls back to nth-of-type segments (an id anchor would keep the path
  // constant across a reorder — see buildElementPath's doc comment — which
  // would defeat the assertions below that the selection's path is updated
  // after a reorder). `data-slot` is only an anchor for `stubItemRects`.
  // THREE_SLOT_HTML's leading sacrificial `<span></span>` absorbs
  // `sanitizeEmbedHtml`'s DOMPurify pass mangling the fragment's FIRST
  // top-level node under happy-dom (see that module's own doc comment), so
  // the real (div-only) wrapper below it survives sanitization intact and
  // every div still lines up 1:1 with the RAW `htmlContent` string the
  // reorder is applied against — a real browser's DOMPurify never does this,
  // so production HTML needs no such padding.
  function seedSortableEmbed(): void {
    seedEmbed(THREE_SLOT_HTML);
  }

  /** happy-dom never runs layout, so `getBoundingClientRect` reads back all
   * zeros for every element — `collectDropSlots`'s slot geometry (and the
   * axis it infers from neighboring rects) needs real numbers to produce a
   * meaningful vertical stack. Stub by `data-slot` (stable across a reorder
   * — it travels with the node, unlike position) rather than by identity, so
   * the same stub keeps working after the shadow tree remounts post-commit. */
  function stubItemRects(): void {
    const rects: Record<string, { left: number; top: number; width: number; height: number }> = {
      "1": { left: 0, top: 0, width: 100, height: 20 },
      "2": { left: 0, top: 20, width: 100, height: 20 },
      "3": { left: 0, top: 40, width: 100, height: 20 },
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const slot = this.getAttribute("data-slot");
      const r = slot ? rects[slot] : undefined;
      const left = r?.left ?? 0;
      const top = r?.top ?? 0;
      const width = r?.width ?? 0;
      const height = r?.height ?? 0;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
  }

  beforeEach(() => {
    resetStores();
    seedSortableEmbed();
    stubItemRects();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // See the comment on the sibling describe block above for why this spy
  // needs `mockClear()` rather than relying on `vi.restoreAllMocks()`.
  function spyOnUpdateNode() {
    const spy = vi.spyOn(useSceneStore.getState(), "updateNode");
    spy.mockClear();
    return spy;
  }

  function itemsOf(host: HTMLElement): { item1: Element; item2: Element; item3: Element } {
    const root = host.shadowRoot!;
    return {
      item1: root.querySelector('[data-slot="1"]')!,
      item2: root.querySelector('[data-slot="2"]')!,
      item3: root.querySelector('[data-slot="3"]')!,
    };
  }

  /** Renders `<EmbedLayer />`, starts picking, resolves the three sortable
   * items, and spies on `updateNode` — the setup nearly every reorder test
   * below needs before it can drag one of the three items. */
  function renderPickingItems(): {
    container: HTMLElement;
    host: HTMLElement;
    item1: Element;
    item2: Element;
    item3: Element;
    updateNodeSpy: ReturnType<typeof spyOnUpdateNode>;
  } {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item1, item2, item3 } = itemsOf(host);
    const updateNodeSpy = spyOnUpdateNode();
    return { container, host, item1, item2, item3, updateNodeSpy };
  }

  /** Makes `el` the picker's current selection via a real click, exactly the
   * way a user would before dragging it — sortable reorder now only
   * re-enters for a pointerdown that lands on the element ALREADY selected
   * (see `EmbedLayer.tsx`'s `handlePointerDown`/`isCurrentSelection`); a
   * pointerdown on anything else forwards to Pixi as a node-move drag
   * instead (covered by its own describe block below). Every reorder test
   * in this block calls this first so it keeps exercising the sortable
   * path rather than silently falling through to the (here, canvas-less,
   * so no-op) node-move branch. */
  function selectItem(item: Element): void {
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
  }

  it("a small pointer move is treated as a click, not a drag — htmlContent is untouched", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item2 } = itemsOf(host);

    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 11, clientY: 31 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 11, clientY: 31 }));
      // The browser still fires a click after a same-element mousedown/up.
      item2.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
    expect(html.indexOf("Two")).toBeLessThan(html.indexOf("Three"));
    // The click after the tiny move still runs the normal click-select path.
    expect(useEmbedPickerStore.getState().selection?.tagName).toBe("div");
  });

  it("a drag past the threshold to the last slot commits one reorder, keeps the element selected with an updated path, and shows/clears the drop indicator", () => {
    const { container, item2, updateNodeSpy } = renderPickingItems();

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      // Past DRAG_THRESHOLD_PX, and nearest (by the stubbed rects above) to
      // the trailing slot (y=60: after item3, i.e. the list's new end).
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
    });

    // The indicator is showing the trailing slot while the drag is live.
    expect(useEmbedPickerStore.getState().dropIndicator).not.toBeNull();

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 80 }));
      // Browser fires a trailing click after pointerup on the same element —
      // it must be suppressed, not re-run selection/commit logic.
      item2.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    // The indicator is cleared once the drag ends, committed or not.
    expect(useEmbedPickerStore.getState().dropIndicator).toBeNull();

    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html.indexOf("One")).toBeLessThan(html.indexOf("Three"));
    expect(html.indexOf("Three")).toBeLessThan(html.indexOf("Two"));

    const selection = useEmbedPickerStore.getState().selection;
    expect(selection?.tagName).toBe("div");
    // The path was updated to the element's new position among its
    // siblings — resolving it against the (remounted) live shadow tree must
    // still find the SAME element (now last), not whatever now sits at the
    // element's old position.
    const host2 = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const resolved = resolveElementPath(host2.shadowRoot!, selection!.path);
    expect(resolved?.textContent).toBe("Two");
  });

  it("dropping on the element's own current slot is a no-op — nothing is committed", () => {
    const { item2, updateNodeSpy } = renderPickingItems();

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 20 }));
      // y=30 is nearest the slot between item1 and item3 — item2's own
      // current position.
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 30 }));
    });

    expect(updateNodeSpy).not.toHaveBeenCalled();
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
    expect(html.indexOf("Two")).toBeLessThan(html.indexOf("Three"));
  });

  it("an out-of-flow (position: absolute) element never starts a drag — no canceller, no commit, no visual transform", () => {
    seedEmbed(
      "<span></span><div>" +
        '<div data-slot="1">One</div>' +
        '<div data-slot="2">Two</div>' +
        '<div data-slot="4" style="position: absolute; left: 0; top: 0;">Four</div>' +
        "</div>",
    );
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const item4 = host.shadowRoot!.querySelector('[data-slot="4"]')!;
    const updateNodeSpy = spyOnUpdateNode();

    // Select it first — even the CURRENT picker selection must not start a
    // sortable drag when it's out-of-flow; `isSortable` is checked in
    // addition to (not instead of) the "is this the current selection"
    // gate.
    act(() => selectItem(item4));

    act(() => {
      item4.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 20, clientY: 20 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 20, clientY: 20 }));
    });

    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeNull();
    expect(updateNodeSpy).not.toHaveBeenCalled();
    expect((item4 as HTMLElement).style.transform).toBe("");
  });

  it("Escape during a drag reverts the live element, clears the indicator, and never commits", () => {
    const { item2, updateNodeSpy } = renderPickingItems();

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
      // Escape reaches the drag through the canceller the gesture
      // registered in the picker store — see keyboardCommands.ts's Escape
      // branch, and `keyboardCommands.embedElementSortable.test.ts` for the
      // global-handler half of this contract.
      useEmbedPickerStore.getState().cancelElementDrag!();
    });

    expect(updateNodeSpy).not.toHaveBeenCalled();
    expect((item2 as HTMLElement).getAttribute("style")).toBeNull();
    expect(useEmbedPickerStore.getState().dropIndicator).toBeNull();
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
    expect(html.indexOf("Two")).toBeLessThan(html.indexOf("Three"));
  });

  // Finding #1: `suppressNextClick` was only ever cleared by `handleClick` —
  // if the pointer is released OUTSIDE the host, the browser's trailing
  // `click` never reaches it, so the flag stayed stuck `true` and ate the
  // next real click. `handlePointerDown` must clear it unconditionally too.
  it("self-heals a stuck suppressNextClick on the next pointerdown, even if the drag-ending click never reached the host", () => {
    const { container, item2, updateNodeSpy } = renderPickingItems();

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 80 }));
      // No trailing click dispatched — as if mouseup landed outside the host.
    });
    expect(updateNodeSpy).toHaveBeenCalledTimes(1);

    useEmbedPickerStore.getState().clearSelection();
    const selectSpy = vi.spyOn(useEmbedPickerStore.getState(), "selectElement");
    selectSpy.mockClear();

    // The committed drag rewrote `htmlContent`, which re-mounts the shadow
    // tree (EmbedHost's mount effect depends on it) — re-query the live
    // element rather than dispatching on the now-detached pre-commit node.
    const host2 = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const item1Again = host2.shadowRoot!.querySelector('[data-slot="1"]')!;

    // A brand-new, genuine click-only gesture (no drag) must still register
    // normally — if suppressNextClick were still stuck true, this click
    // would be silently swallowed instead of running selection.
    act(() => {
      item1Again.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 0, clientY: 0 }));
      item1Again.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  // Finding #2: Escape must cancel an in-progress drag WITHOUT also exiting
  // the picker on the same keypress — parity with a native-node drag's
  // Escape handling in keyboardCommands.ts. The gesture cannot win that race
  // with a capture-phase `keydown` listener of its own (capture listeners on
  // the same target fire in REGISTRATION order, and the global canvas
  // handler is registered at app mount, before picking starts), so it
  // publishes a canceller the global handler calls instead. This asserts the
  // gesture's half of that contract: the canceller exists exactly while a
  // real drag is in flight.
  it("publishes a drag canceller only once the drag crosses the threshold, and clears it on drag end", () => {
    const { item2 } = renderPickingItems();

    act(() => selectItem(item2));
    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeNull();

    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      // Below the 3px threshold: still just a click, so Escape must keep
      // its normal meaning (exit the picker), not cancel a "drag".
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 11, clientY: 31 }));
    });
    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeNull();

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
    });
    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeTypeOf("function");

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 80 }));
    });
    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeNull();
  });

  it("leaves Escape alone when no drag is in flight, so it can still exit the picker", () => {
    render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const globalHandler = vi.fn();
    window.addEventListener("keydown", globalHandler);

    try {
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });

      expect(globalHandler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", globalHandler);
    }
  });

  // Finding #5: only the primary mouse button (or primary touch/pen
  // contact) may start a drag — a right/middle-click drag has no visible
  // warning (contextmenu is swallowed too) besides the element silently
  // ending up moved.
  it.each([
    { name: "a right-click drag (non-primary button)", override: { button: 2 } },
    { name: "a non-primary-pointer drag (isPrimary false)", override: { isPrimary: false } },
  ])("ignores $name", ({ override }) => {
    const { item2, updateNodeSpy } = renderPickingItems();

    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30, ...override }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80, ...override }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 80, ...override }));
    });

    expect(updateNodeSpy).not.toHaveBeenCalled();
    expect((item2 as HTMLElement).getAttribute("style")).toBeNull();
  });

  // Finding #6: a second finger/stylus landing anywhere while a drag is in
  // flight must never steer or end THAT drag — only its own `pointerId`
  // may.
  it("ignores pointermove/pointerup from a different pointerId than the one that started the drag", () => {
    const { item2, updateNodeSpy } = renderPickingItems();

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(
        embedPointerEvent("pointerdown", { clientX: 10, clientY: 30, pointerId: 1 }),
      );
      // A second pointer moving far away must not steer or end pointer 1's
      // drag.
      window.dispatchEvent(
        embedPointerEvent("pointermove", { clientX: 90, clientY: 90, pointerId: 2 }),
      );
      window.dispatchEvent(
        embedPointerEvent("pointerup", { clientX: 90, clientY: 90, pointerId: 2 }),
      );
    });
    expect((item2 as HTMLElement).getAttribute("style")).toBeNull(); // never moved by the wrong pointer
    expect(updateNodeSpy).not.toHaveBeenCalled(); // never ended by the wrong pointer

    act(() => {
      window.dispatchEvent(
        embedPointerEvent("pointermove", { clientX: 10, clientY: 80, pointerId: 1 }),
      );
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 80, pointerId: 1 }));
    });

    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html.indexOf("Three")).toBeLessThan(html.indexOf("Two"));
  });

  // Finding #7: same gate as EmbedElementProperties.applyEdit's
  // `if (readOnly) return;` and EmbedElementHighlight's `canEditScene` check
  // — a picker drag must never be able to write to the scene outside edit
  // mode.
  it("does not commit a drag outside edit mode, and reverts the live element", () => {
    const { item2, updateNodeSpy } = renderPickingItems();

    // Select it (via a plain click, unaffected by `canEditScene`) BEFORE
    // switching to view mode, so the pointerdown below still takes the
    // sortable-reorder path rather than falling through to a node-move
    // drag it has nothing to do with.
    act(() => selectItem(item2));
    act(() => useEditorModeStore.setState({ mode: "view" }));
    try {
      act(() => {
        item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
        window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
        window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 80 }));
      });

      expect(updateNodeSpy).not.toHaveBeenCalled();
      expect((item2 as HTMLElement).getAttribute("style")).toBeNull();
      const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string })
        .htmlContent!;
      expect(html.indexOf("One")).toBeLessThan(html.indexOf("Two"));
      expect(html.indexOf("Two")).toBeLessThan(html.indexOf("Three"));
    } finally {
      act(() => useEditorModeStore.setState({ mode: "edit" }));
    }
  });

  // Finding #8: if pointerup/pointercancel is lost entirely (released over
  // browser chrome), the abandoned drag must not keep steering the old
  // element forever — the very next pointerdown must clean it up first,
  // even before that pointerdown's own early returns.
  it("a lost pointerup self-heals on the next pointerdown, reverting the abandoned drag", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item2, item3 } = itemsOf(host);

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
      // pointerup/pointercancel never arrives.
    });
    expect((item2 as HTMLElement).style.transform).not.toBe(""); // visually dragged

    const updateNodeSpy = spyOnUpdateNode();

    // item2's own commit never landed (its pointerup was lost), so it is
    // still the picker's selection — select item3 instead before dragging
    // IT, for the same reason as item2 above.
    act(() => selectItem(item3));
    act(() => {
      item3.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 50 }));
    });

    // The abandoned item2 drag was cleaned up and reverted before the new
    // drag on `item3` was even allowed to start.
    expect((item2 as HTMLElement).getAttribute("style")).toBeNull();

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 0 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 0 }));
    });

    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html.indexOf("Three")).toBeLessThan(html.indexOf("One"));
  });

  // Code-review finding #1: slots used to be computed ONCE, right when the
  // drag crossed the threshold, in CLIENT coordinates — but `forwardWheel`
  // deliberately keeps zoom/pan (and any live reflow) active while picking,
  // so a mid-drag rect change made the cached slot list stale: the
  // indicator (and a subsequent commit) would keep pointing at the OLD
  // sibling positions. This drags item2 to a spot nearest item3's ORIGINAL
  // slot, then relocates item3 far away (simulating a reflow/zoom) WITHOUT
  // moving the cursor, and asserts the indicator moves too — proof slots are
  // rebuilt from live rects on every move, not cached from drag-start.
  it("recomputes drop slots on every pointermove instead of caching them from drag-start", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item2 } = itemsOf(host);

    act(() => selectItem(item2));
    act(() => {
      // pointerdown well above the cursor's landing spot, so the first move
      // below clears DRAG_THRESHOLD_PX (3px).
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 10 }));
      // Past the threshold. With the ORIGINAL rects (item1: 0-20, item3:
      // 40-60), y=32 is nearest the slot between item1 and item3 (indicator
      // centered at y=30) — item2's own current slot.
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 32 }));
    });

    const indicatorAtStart = useEmbedPickerStore.getState().dropIndicator;
    expect(indicatorAtStart?.top).toBeCloseTo(29, 0); // 30 - thickness/2

    // Relocate item3 far down the page — stands in for a reflow or a wheel
    // zoom happening mid-drag (both stay live while picking; see
    // `forwardWheel`). The cursor does NOT move.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const slot = this.getAttribute("data-slot");
      const rects: Record<string, { left: number; top: number; width: number; height: number }> = {
        "1": { left: 0, top: 0, width: 100, height: 20 },
        "2": { left: 0, top: 20, width: 100, height: 20 },
        "3": { left: 0, top: 400, width: 100, height: 20 },
      };
      const r = slot ? rects[slot] : undefined;
      const left = r?.left ?? 0;
      const top = r?.top ?? 0;
      const width = r?.width ?? 0;
      const height = r?.height ?? 0;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });

    act(() => {
      // Same cursor position as before. With item3 now far away, the
      // nearest slot (by the FRESH rects) is the one before item1
      // (indicator centered at item1's top edge, y=0) — a stale, cached
      // slot list would still report the old y≈29 indicator instead.
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 32 }));
    });

    const indicatorAfterReflow = useEmbedPickerStore.getState().dropIndicator;
    expect(indicatorAfterReflow?.top).toBeCloseTo(-1, 0); // 0 - thickness/2
    expect(indicatorAfterReflow?.top).not.toBeCloseTo(indicatorAtStart!.top, 0);

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 32 }));
    });
  });

  // Code-review finding #3: the dragged element gets `pointer-events: none`
  // once the drag starts, so `handleMove`'s `composedPath()[0]` resolves to
  // whatever sibling the cursor happens to be over instead — without a gate,
  // that kept overwriting `hoveredPath` on every sibling crossed, drawing a
  // hover box that chased the cursor on top of the insertion-line indicator.
  it("does not update the hover path while a drag is in flight, and clears any stale one at drag start", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item1, item2, item3 } = itemsOf(host);

    // Hover item1 first, as if the pointer passed over it on the way to
    // item2 — this is the stale hover the drag must clear.
    act(() => {
      item1.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));
    });
    expect(useEmbedPickerStore.getState().hoveredPath).not.toBeNull();

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      // Cross the threshold — this is the moment the stale hover must clear.
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
    });
    expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();

    // With `pointer-events: none` on the dragged element, this move's
    // `composedPath()[0]` (dispatched at item3's DOM location) resolves to
    // item3 — but must not be treated as a hover while the drag is live.
    act(() => {
      item3.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 50 }));
    });
    expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 10, clientY: 50 }));
    });
  });

  // Code-review finding #4: overwriting `transform` outright for the ghost
  // drag used to clobber whatever the element's own CSS was already
  // expressing (e.g. a centering `translateX(-50%)`), snapping the element
  // to an untransformed position the instant the drag started. The fix
  // composes the ghost's `translate(...)` OUTSIDE the element's own computed
  // transform instead of replacing it.
  it("composes the ghost drag's translate with the element's own authored transform instead of overwriting it", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item2 } = itemsOf(host);
    item2.setAttribute("style", "transform: translateX(-50%)");
    vi.spyOn(item2, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return {
        left: 0,
        top: 20,
        right: 100,
        bottom: 40,
        width: 100,
        height: 20,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      } as DOMRect;
    });
    // Capture the REAL getComputedStyle before spying, so the spy's
    // fallback for every other element doesn't recurse into itself.
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      if (el === item2) {
        return { transform: "translateX(-50%)" } as CSSStyleDeclaration;
      }
      return realGetComputedStyle(el) as CSSStyleDeclaration;
    });

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 15, clientY: 34 }));
    });

    const transform = (item2 as HTMLElement).style.transform;
    expect(transform).toContain("translate(5px, 4px)");
    expect(transform).toContain("translateX(-50%)");
    // The ghost offset comes FIRST (outer), preserving screen-axis movement
    // regardless of the base transform.
    expect(transform.indexOf("translate(5px")).toBeLessThan(transform.indexOf("translateX(-50%)"));

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 15, clientY: 34 }));
    });
  });

  // Finding #9: a streamed `edit_embed_html`/`batch_design` mutation (or an
  // undo) can change `htmlContent` mid-drag, re-mounting the shadow tree and
  // detaching `drag.el`. Committing anyway would apply the reorder to
  // whatever element the OLD `nth-of-type` path now resolves to in the NEW
  // html — the wrong element.
  it("aborts a drag without committing when htmlContent changes mid-gesture", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const { item2 } = itemsOf(host);

    act(() => selectItem(item2));
    act(() => {
      item2.dispatchEvent(embedPointerEvent("pointerdown", { clientX: 10, clientY: 30 }));
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 10, clientY: 80 }));
    });

    const updateNodeSpy = spyOnUpdateNode();

    // Stands in for a streamed edit_embed_html/batch_design mutation (or an
    // undo) landing mid-drag.
    act(() => {
      useSceneStore.getState().updateNode("e1", {
        htmlContent:
          "<span></span><div>" +
          '<div data-slot="1">One</div>' +
          '<div data-slot="2">Two (edited)</div>' +
          '<div data-slot="3">Three</div>' +
          "</div>",
      });
    });
    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    expect((item2 as HTMLElement).isConnected).toBe(false); // detached by the shadow remount

    act(() => {
      window.dispatchEvent(embedPointerEvent("pointermove", { clientX: 40, clientY: 40 }));
      window.dispatchEvent(embedPointerEvent("pointerup", { clientX: 40, clientY: 40 }));
    });

    // No second commit from the drag itself.
    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    expect(
      (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent,
    ).toContain("Two (edited)");
  });
});

describe("<EmbedLayer /> element picker interaction — empty-path guard", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
    vi.resetModules();
  });
  afterEach(() => {
    cleanup();
    vi.doUnmock("@/lib/embedElementPicker");
    vi.resetModules();
  });

  it("rejects a click selection whose path is empty instead of storing it", async () => {
    // Forces describeEmbedElement to return an empty path (as it would for
    // the no-body mountHtmlWithBodyStyles branch pre-fix, or any other
    // future case where the resolved pick target IS root) and asserts the
    // click handler's own guard refuses to store it — not just relying on
    // resolvePickableElement/buildElementPath to prevent this upstream.
    vi.doMock("@/lib/embedElementPicker", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/lib/embedElementPicker")>();
      return {
        ...actual,
        describeEmbedElement: (
          el: Element,
          root: ParentNode,
          embedId: string,
        ) => ({
          ...actual.describeEmbedElement(el, root, embedId),
          path: "",
        }),
      };
    });

    const { EmbedLayer: MockedEmbedLayer } = await import("../EmbedLayer");
    const { useEmbedPickerStore: mockedEmbedPickerStore } = await import(
      "@/store/embedPickerStore"
    );
    const { useSceneStore: mockedSceneStore } = await import("@/store/sceneStore");

    mockedSceneStore.setState({
      nodesById: {
        e1: {
          id: "e1",
          type: "embed",
          name: "Code",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          htmlContent: "<div><button id='cta'>Buy</button></div>",
        } as unknown as FlatSceneNode,
      },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
    } as never);

    const { container } = render(<MockedEmbedLayer />);
    act(() => mockedEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => {
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(mockedEmbedPickerStore.getState().selection).toBeNull();
  });

  it("rejects a hover with an empty path instead of storing it", async () => {
    vi.doMock("@/lib/embedElementPicker", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@/lib/embedElementPicker")>();
      return {
        ...actual,
        buildElementPath: () => "",
      };
    });

    const { EmbedLayer: MockedEmbedLayer } = await import("../EmbedLayer");
    const { useEmbedPickerStore: mockedEmbedPickerStore } = await import(
      "@/store/embedPickerStore"
    );
    const { useSceneStore: mockedSceneStore } = await import("@/store/sceneStore");

    mockedSceneStore.setState({
      nodesById: {
        e1: {
          id: "e1",
          type: "embed",
          name: "Code",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          htmlContent: "<div><button id='cta'>Buy</button></div>",
        } as unknown as FlatSceneNode,
      },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
    } as never);

    const { container } = render(<MockedEmbedLayer />);
    act(() => mockedEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => {
      button.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));
    });

    expect(mockedEmbedPickerStore.getState().hoveredPath).toBeNull();
  });
});
