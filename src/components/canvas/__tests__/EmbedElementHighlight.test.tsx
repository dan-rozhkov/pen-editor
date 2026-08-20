import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedElementHighlight } from "../EmbedElementHighlight";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

/** Build a canvas container + embed host + shadow-DOM button, all attached
 * to document.body, mirroring what EmbedLayer produces at runtime. */
function mountEmbedDom(): { canvas: HTMLElement; button: HTMLElement } {
  const canvas = document.createElement("div");
  canvas.setAttribute("data-canvas", "");
  document.body.appendChild(canvas);

  const host = document.createElement("div");
  host.setAttribute("data-embed-id", "embed1");
  canvas.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const content = document.createElement("div");
  content.innerHTML = `<button id="cta">Buy</button>`;
  shadow.appendChild(content);

  return { canvas, button: shadow.querySelector("#cta")! };
}

function stubRects(canvasRect: DOMRect, buttonRect: DOMRect) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-canvas")) return canvasRect;
    return buttonRect;
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
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
}

describe("<EmbedElementHighlight />", () => {
  beforeEach(() => {
    resetStores();
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: {
        embed1: {
          id: "embed1",
          type: "embed",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          htmlContent: "<div></div>",
        } as unknown as FlatSceneNode,
      },
      parentById: { embed1: null },
      childrenById: {},
      rootIds: ["embed1"],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders nothing when neither hovering nor a selection is set", () => {
    mountEmbedDom();
    const { container } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-element-highlight]")).toBeNull();
  });

  it("draws a 2px hover box with a tag label while picking", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1) > button:nth-of-type(1)");

    const { container } = render(<EmbedElementHighlight />);

    const box = container.querySelector('[data-embed-element-box][data-kind="hover"]') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.left).toBe("20px");
    expect(box.style.top).toBe("10px");
    expect(box.style.width).toBe("60px");
    expect(box.style.height).toBe("24px");

    const outline = box.querySelector("[data-embed-element-outline]") as HTMLElement;
    expect(outline.style.borderWidth).toBe("2px");
    expect(outline.style.borderColor).toBe("#0d99ff");

    expect(container.querySelector("[data-embed-element-label]")?.textContent).toBe("button");
  });

  it("draws a 1px selection box with no label once an element is picked", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));

    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const { container } = render(<EmbedElementHighlight />);

    const box = container.querySelector('[data-embed-element-box][data-kind="selection"]') as HTMLElement;
    expect(box).toBeTruthy();
    const outline = box.querySelector("[data-embed-element-outline]") as HTMLElement;
    expect(outline.style.borderWidth).toBe("1px");
    expect(container.querySelector('[data-embed-element-box][data-kind="hover"]')).toBeNull();
  });

  it("skips rendering the selection box once its embed node is removed from the scene", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));

    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const { container } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-element-box]")).toBeTruthy();

    act(() => {
      useSceneStore.setState({ nodesById: {}, parentById: {}, childrenById: {}, rootIds: [] });
    });

    expect(container.querySelector("[data-embed-element-box]")).toBeNull();
  });

  it("renders nothing in view mode even with an active selection — never paints over a view-mode canvas", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });
    useEditorModeStore.setState({ mode: "view" });

    const { container } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-element-box]")).toBeNull();
  });

  it("renders nothing in present mode even with an active selection — never paints over a presented slide", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });
    useEditorModeStore.setState({ mode: "present" });

    const { container } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-element-box]")).toBeNull();
  });

  it("does not subscribe to viewport/layout stores while idle (no picking, no selection)", () => {
    mountEmbedDom();
    const viewportSubscribe = vi.spyOn(useViewportStore, "subscribe");
    const layoutSubscribe = vi.spyOn(useLayoutStore, "subscribe");

    render(<EmbedElementHighlight />);

    // This is the perf-sensitive hot path: EmbedElementHighlight is mounted
    // for the full lifetime of PixiCanvas, so subscribing unconditionally
    // would schedule a React state update on every pan/zoom tick (~60/s)
    // purely to keep re-rendering `null`.
    expect(viewportSubscribe).not.toHaveBeenCalled();
    expect(layoutSubscribe).not.toHaveBeenCalled();
  });

  it("subscribes to viewport/layout stores once picking starts, and unsubscribes once it's idle again", () => {
    mountEmbedDom();
    const originalViewportSubscribe = useViewportStore.subscribe.bind(useViewportStore);
    let lastViewportUnsub: (() => void) | null = null;
    const viewportSubscribe = vi
      .spyOn(useViewportStore, "subscribe")
      .mockImplementation((listener) => {
        const unsub = originalViewportSubscribe(listener);
        lastViewportUnsub = vi.fn(unsub);
        return lastViewportUnsub;
      });

    render(<EmbedElementHighlight />);
    expect(viewportSubscribe).not.toHaveBeenCalled();

    act(() => useEmbedPickerStore.getState().startPicking("embed1"));
    expect(viewportSubscribe).toHaveBeenCalledTimes(1);
    expect(lastViewportUnsub).not.toHaveBeenCalled();

    act(() => useEmbedPickerStore.getState().stopPicking());
    // stopPicking with no selection returns to idle — the effect must tear
    // its subscriptions back down rather than leaving them dangling.
    expect(lastViewportUnsub).toHaveBeenCalledTimes(1);
  });

  it("does not re-render when an unrelated scene node changes", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const onRender = vi.fn();
    render(
      <Profiler id="highlight" onRender={onRender}>
        <EmbedElementHighlight />
      </Profiler>,
    );
    onRender.mockClear();

    act(() => {
      useSceneStore.setState((s) => ({
        nodesById: {
          ...s.nodesById,
          other: { id: "other", type: "rect", x: 0, y: 0, width: 1, height: 1 } as unknown as FlatSceneNode,
        },
        parentById: { ...s.parentById, other: null },
        childrenById: { ...s.childrenById },
        rootIds: [...s.rootIds, "other"],
      }));
    });

    // The `nodesById` subscription is narrowed to the selected embed's own
    // node, so an unrelated node being added elsewhere in the scene must not
    // trigger a re-render — the old bug was an unconditional `nodesById`
    // subscription re-rendering on every scene mutation.
    expect(onRender).not.toHaveBeenCalled();
  });

  it("re-renders when the active embed's own node changes", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const onRender = vi.fn();
    render(
      <Profiler id="highlight" onRender={onRender}>
        <EmbedElementHighlight />
      </Profiler>,
    );
    onRender.mockClear();

    act(() => {
      const current = useSceneStore.getState().nodesById.embed1;
      useSceneStore.setState((s) => ({
        nodesById: { ...s.nodesById, embed1: { ...current, width: 200 } },
      }));
    });

    expect(onRender).toHaveBeenCalled();
  });

  it("recomputes the box when the embed's internal content scrolls", () => {
    const { canvas } = mountEmbedDom();
    const canvasRect = rect(0, 0, 400, 300);
    let buttonRect = rect(20, 10, 60, 24);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute("data-canvas")) return canvasRect;
      return buttonRect;
    });

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1) > button:nth-of-type(1)");

    const { container } = render(<EmbedElementHighlight />);
    let box = container.querySelector('[data-embed-element-box][data-kind="hover"]') as HTMLElement;
    expect(box.style.top).toBe("10px");

    // Simulate the embed's own content scrolling — nothing in
    // viewportStore/layoutStore changes, only the shadow tree's internal
    // layout, so this must be picked up via the scroll listener directly on
    // the shadow root.
    buttonRect = rect(20, -40, 60, 24);
    const host = canvas.querySelector<HTMLElement>('[data-embed-id="embed1"]')!;
    const content = host.shadowRoot!.firstElementChild as HTMLElement;

    act(() => {
      content.dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    box = container.querySelector('[data-embed-element-box][data-kind="hover"]') as HTMLElement;
    expect(box.style.top).toBe("-40px");
  });
});
