import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function seedEmbed(htmlContent = "<div><button id='cta'>Buy</button></div>"): void {
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
        htmlContent,
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
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
});

describe("<EmbedLayer /> element picker — drag to reposition", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => cleanup());

  // `vi.spyOn(useSceneStore.getState(), "updateNode")` returns the SAME mock
  // (with its accumulated call history) once one test has already spied on
  // it: `resetStores()`'s `setState` merge carries the spy function forward
  // as the "current" `updateNode` on every subsequent state object, and
  // `vi.spyOn` treats an already-mocked function as already spied rather
  // than wrapping it again — so `vi.restoreAllMocks()` (which restores the
  // stale object `spyOn` originally captured, not the store's current one)
  // does not help. Clearing the mock right after creating it is what
  // actually gives each test a clean call count.
  function spyOnUpdateNode() {
    const spy = vi.spyOn(useSceneStore.getState(), "updateNode");
    spy.mockClear();
    return spy;
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

  it("a small pointer move is treated as a click, not a drag — htmlContent is untouched", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 10, clientY: 10 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 11, clientY: 11 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 11, clientY: 11 }));
      // The browser still fires a click after a same-element mousedown/up.
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(
      (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent,
    ).toBe("<div><button id='cta'>Buy</button></div>");
    // The click after the tiny move still runs the normal click-select path.
    expect(useEmbedPickerStore.getState().selection?.tagName).toBe("button");
  });

  it("a move past the threshold commits one repositioned htmlContent update and selects the dragged element", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 8 }));
      // Browser fires a trailing click after pointerup on the same element —
      // it must be suppressed, not re-run selection/commit logic.
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    });

    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html).toContain("position: relative");
    expect(html).toContain("left: 20px");
    expect(html).toContain("top: 8px");

    const selection = useEmbedPickerStore.getState().selection;
    expect(selection?.tagName).toBe("button");
  });

  it("Escape during a drag reverts the live element and never commits", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
      // Escape reaches the drag through the canceller the gesture
      // registered in the picker store — see keyboardCommands.ts's Escape
      // branch, and `keyboardCommands.embedElementDrag.test.ts` for the
      // global-handler half of this contract.
      useEmbedPickerStore.getState().cancelElementDrag!();
    });

    expect(updateNodeSpy).not.toHaveBeenCalled();
    expect(button.getAttribute("style")).toBeNull();
    expect(
      (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent,
    ).toBe("<div><button id='cta'>Buy</button></div>");
  });

  // Finding #1: `suppressNextClick` was only ever cleared by `handleClick` —
  // if the pointer is released OUTSIDE the host, the browser's trailing
  // `click` never reaches it, so the flag stayed stuck `true` and ate the
  // next real click. `handlePointerDown` must clear it unconditionally too.
  it("self-heals a stuck suppressNextClick on the next pointerdown, even if the drag-ending click never reached the host", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 8 }));
      // No trailing click dispatched — as if mouseup landed outside the host.
    });
    expect(updateNodeSpy).toHaveBeenCalledTimes(1);

    useEmbedPickerStore.getState().clearSelection();
    const selectSpy = vi.spyOn(useEmbedPickerStore.getState(), "selectElement");
    selectSpy.mockClear();

    // The committed drag rewrote `htmlContent`, which re-mounts the shadow
    // tree (EmbedHost's mount effect depends on it) — re-query the live
    // button rather than dispatching on the now-detached pre-commit node.
    const button2 = host.shadowRoot!.querySelector("button")!;

    // A brand-new, genuine click-only gesture (no drag) must still register
    // normally — if suppressNextClick were still stuck true, this click
    // would be silently swallowed instead of running selection.
    act(() => {
      button2.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 0, clientY: 0 }));
      button2.dispatchEvent(
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
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    spyOnUpdateNode();

    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeNull();

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      // Below the 3px threshold: still just a click, so Escape must keep
      // its normal meaning (exit the picker), not cancel a "drag".
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 1, clientY: 1 }));
    });
    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeNull();

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
    });
    expect(useEmbedPickerStore.getState().cancelElementDrag).toBeTypeOf("function");

    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 8 }));
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
  it("ignores a right-click drag (non-primary button)", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0, button: 2 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 20, button: 2 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 20, button: 2 }));
    });

    expect(updateNodeSpy).not.toHaveBeenCalled();
    expect(button.getAttribute("style")).toBeNull();
  });

  it("ignores a non-primary-pointer drag (isPrimary false)", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      button.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 0, clientY: 0, isPrimary: false }),
      );
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 20, clientY: 20, isPrimary: false }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { clientX: 20, clientY: 20, isPrimary: false }),
      );
    });

    expect(updateNodeSpy).not.toHaveBeenCalled();
    expect(button.getAttribute("style")).toBeNull();
  });

  // Finding #6: a second finger/stylus landing anywhere while a drag is in
  // flight must never steer or end THAT drag — only its own `pointerId`
  // may.
  it("ignores pointermove/pointerup from a different pointerId than the one that started the drag", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 }));
      // A second pointer moving far away must not steer or end pointer 1's
      // drag.
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 90, clientY: 90, pointerId: 2 }),
      );
      window.dispatchEvent(
        pointerEvent("pointerup", { clientX: 90, clientY: 90, pointerId: 2 }),
      );
    });
    expect(button.getAttribute("style")).toBeNull(); // never moved by the wrong pointer
    expect(updateNodeSpy).not.toHaveBeenCalled(); // never ended by the wrong pointer

    act(() => {
      window.dispatchEvent(
        pointerEvent("pointermove", { clientX: 20, clientY: 8, pointerId: 1 }),
      );
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 8, pointerId: 1 }));
    });

    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html).toContain("left: 20px");
  });

  // Finding #7: same gate as EmbedElementProperties.applyEdit's
  // `if (readOnly) return;` and EmbedElementHighlight's `canEditScene` check
  // — a picker drag must never be able to write to the scene outside edit
  // mode.
  it("does not commit a drag outside edit mode, and reverts the live element", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateNodeSpy = spyOnUpdateNode();

    act(() => useEditorModeStore.setState({ mode: "view" }));
    try {
      act(() => {
        button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
        window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
        window.dispatchEvent(pointerEvent("pointerup", { clientX: 20, clientY: 8 }));
      });

      expect(updateNodeSpy).not.toHaveBeenCalled();
      expect(button.getAttribute("style")).toBeNull();
      expect(
        (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent,
      ).toBe("<div><button id='cta'>Buy</button></div>");
    } finally {
      act(() => useEditorModeStore.setState({ mode: "edit" }));
    }
  });

  // Finding #8: if pointerup/pointercancel is lost entirely (released over
  // browser chrome), the abandoned drag must not keep steering the old
  // element forever — the very next pointerdown must clean it up first,
  // even before that pointerdown's own early returns.
  it("a lost pointerup self-heals on the next pointerdown, reverting the abandoned drag", () => {
    seedEmbed("<div><button id='cta'>Buy</button><span id='label'>Label</span></div>");
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const span = host.shadowRoot!.querySelector("span")!;

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
      // pointerup/pointercancel never arrives.
    });
    expect(button.style.left).toBe("20px"); // visually dragged

    const updateNodeSpy = spyOnUpdateNode();

    act(() => {
      span.dispatchEvent(pointerEvent("pointerdown", { clientX: 5, clientY: 5 }));
    });

    // The abandoned button drag was cleaned up and reverted before the new
    // drag on `span` was even allowed to start.
    expect(button.getAttribute("style")).toBeNull();

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 15, clientY: 15 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 15, clientY: 15 }));
    });

    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    const html = (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent!;
    expect(html).toContain('id="label"');
  });

  // Finding #9: a streamed `edit_embed_html`/`batch_design` mutation (or an
  // undo) can change `htmlContent` mid-drag, re-mounting the shadow tree and
  // detaching `drag.el`. Committing anyway would apply the drag's style to
  // whatever element the OLD `nth-of-type` path now resolves to in the NEW
  // html — the wrong element.
  it("aborts a drag without committing when htmlContent changes mid-gesture", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => {
      button.dispatchEvent(pointerEvent("pointerdown", { clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 20, clientY: 8 }));
    });

    const updateNodeSpy = spyOnUpdateNode();

    // Stands in for a streamed edit_embed_html/batch_design mutation (or an
    // undo) landing mid-drag.
    act(() => {
      useSceneStore
        .getState()
        .updateNode("e1", { htmlContent: "<div><button id='cta'>Buy now</button></div>" });
    });
    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    expect(button.isConnected).toBe(false); // detached by the shadow remount

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", { clientX: 40, clientY: 40 }));
      window.dispatchEvent(pointerEvent("pointerup", { clientX: 40, clientY: 40 }));
    });

    // No second commit from the drag itself.
    expect(updateNodeSpy).toHaveBeenCalledTimes(1);
    expect(
      (useSceneStore.getState().nodesById.e1 as { htmlContent?: string }).htmlContent,
    ).toBe("<div><button id='cta'>Buy now</button></div>");
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
