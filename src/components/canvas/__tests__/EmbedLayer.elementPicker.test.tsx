import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
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
