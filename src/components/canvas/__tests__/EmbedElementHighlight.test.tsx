import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { EmbedElementHighlight } from "../EmbedElementHighlight";
import { launchEmbedElementAgentChat } from "@/lib/launchEmbedElementAgentChat";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

vi.mock("@/lib/launchEmbedElementAgentChat", () => ({
  launchEmbedElementAgentChat: vi.fn(),
}));

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
    vi.mocked(launchEmbedElementAgentChat).mockReset();
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

  it("draws a 2px hover box with no tag label while picking", () => {
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

    // Native nodes never show a tag-name label on hover — the embed overlay
    // must read identically, so the label is gone entirely, not just
    // conditionally suppressed.
    expect(container.querySelector("[data-embed-element-label]")).toBeNull();
  });

  it("never renders a tag label while hovering the element that is already selected", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    const path = "div:nth-of-type(1) > button:nth-of-type(1)";
    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path,
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });
    useEmbedPickerStore.getState().setHoveredPath(path);

    const { container } = render(<EmbedElementHighlight />);

    expect(container.querySelector('[data-embed-element-box][data-kind="hover"]')).toBeTruthy();
    expect(container.querySelector("[data-embed-element-label]")).toBeNull();
  });

  it("never renders a tag label for a hovered element that is not the selected one", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "",
      outerHtml: "<div></div>",
    });
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1) > button:nth-of-type(1)");

    const { container } = render(<EmbedElementHighlight />);

    expect(container.querySelector("[data-embed-element-label]")).toBeNull();
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

  it("withholds the selection box while the selected element is the one being inline-edited (Finding 6)", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));

    const path = "div:nth-of-type(1) > button:nth-of-type(1)";
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path,
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });
    useEmbedPickerStore.getState().startElementEdit("embed1", path);

    const { container } = render(<EmbedElementHighlight />);

    expect(container.querySelector("[data-embed-element-box]")).toBeNull();
  });

  it("draws the selection box again once inline editing of that same element ends", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));

    const path = "div:nth-of-type(1) > button:nth-of-type(1)";
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path,
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });
    useEmbedPickerStore.getState().startElementEdit("embed1", path);

    const { container, rerender } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-element-box]")).toBeNull();

    act(() => useEmbedPickerStore.getState().stopElementEdit());
    rerender(<EmbedElementHighlight />);

    expect(
      container.querySelector('[data-embed-element-box][data-kind="selection"]'),
    ).toBeTruthy();
  });

  it("draws a hover box from a layers-panel row hover (hoveredEmbedId, no picking)", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    // No startPicking call here — this is the layers-panel path, which sets
    // hoveredEmbedId/hoveredPath directly without entering "select element"
    // mode.
    useEmbedPickerStore
      .getState()
      .setHoveredElement("embed1", "div:nth-of-type(1) > button:nth-of-type(1)");

    const { container } = render(<EmbedElementHighlight />);

    const box = container.querySelector('[data-embed-element-box][data-kind="hover"]') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.left).toBe("20px");
    expect(box.style.top).toBe("10px");
  });

  it("does not draw a panel-hover box once hoveredEmbedId/hoveredPath are cleared", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    useEmbedPickerStore
      .getState()
      .setHoveredElement("embed1", "div:nth-of-type(1) > button:nth-of-type(1)");
    useEmbedPickerStore.getState().setHoveredElement(null, null);

    const { container } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-element-highlight]")).toBeNull();
  });

  it("does not subscribe to viewport/layout stores from a panel hover while picking is also active elsewhere is irrelevant — picking still wins for path resolution", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    // pickingEmbedId takes priority over hoveredEmbedId for which embed the
    // hover path resolves against — a stale hoveredEmbedId from a previous
    // panel hover must not hijack an active canvas pick.
    useEmbedPickerStore.getState().setHoveredElement("some-other-embed", "p:nth-of-type(1)");
    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1) > button:nth-of-type(1)");

    const { container } = render(<EmbedElementHighlight />);
    const box = container.querySelector('[data-embed-element-box][data-kind="hover"]') as HTMLElement;
    expect(box).toBeTruthy();
    expect(box.style.top).toBe("10px");
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

  it("draws a size badge with offsetWidth/offsetHeight on the selection box", () => {
    const { button } = mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));
    Object.defineProperty(button, "offsetWidth", { value: 123, configurable: true });
    Object.defineProperty(button, "offsetHeight", { value: 45, configurable: true });

    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const { container } = render(<EmbedElementHighlight />);

    const badge = container.querySelector("[data-embed-element-size-badge]") as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("123 × 45");

    // Must match the native Pixi-drawn size label 1:1 (SIZE_LABEL_* in
    // src/pixi/selectionOverlay/constants.ts + drawSizeLabel): 11px
    // system-ui text, 17px total badge height (11 + 3*2 padding), 6px
    // horizontal / 3px vertical padding — not the app's inherited font or a
    // 14px line-height, which would make the badge 20px tall instead.
    expect(badge.style.fontSize).toBe("11px");
    expect(badge.style.lineHeight).toBe("11px");
    expect(badge.style.fontFamily).toContain("system-ui");
    expect(badge.style.padding).toBe("3px 6px");
  });

  it("does not draw a size badge on the hover box", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1) > button:nth-of-type(1)");

    const { container } = render(<EmbedElementHighlight />);

    expect(container.querySelector('[data-embed-element-box][data-kind="hover"]')).toBeTruthy();
    expect(container.querySelector("[data-embed-element-size-badge]")).toBeNull();
  });

  it("uses offsetWidth/offsetHeight for the badge text, not the zoomed getBoundingClientRect box", () => {
    const { button } = mountEmbedDom();
    // Screen-space rect is 2x the element's real CSS size, as it would be at
    // 200% zoom on the embed's `transform: scale(zoom)` container.
    stubRects(rect(0, 0, 400, 300), rect(10, 10, 200, 100));
    Object.defineProperty(button, "offsetWidth", { value: 100, configurable: true });
    Object.defineProperty(button, "offsetHeight", { value: 50, configurable: true });

    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const { container } = render(<EmbedElementHighlight />);

    const badge = container.querySelector("[data-embed-element-size-badge]");
    // Must read 100 × 50 (offsetWidth/offsetHeight), not 200 × 100
    // (getBoundingClientRect, which is screen pixels under zoom).
    expect(badge?.textContent).toBe("100 × 50");
  });

  it("draws the drop indicator line from dropIndicator, converted into canvas-relative coordinates", () => {
    mountEmbedDom();
    // Canvas origin offset from the viewport, so the conversion from the
    // CLIENT coordinates `dropIndicator` carries actually has to subtract
    // something for the test to be meaningful.
    stubRects(rect(50, 100, 400, 300), rect(0, 0, 0, 0));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setDropIndicator({ left: 70, top: 130, width: 60, height: 2 });

    const { container } = render(<EmbedElementHighlight />);

    const indicator = container.querySelector<HTMLElement>("[data-embed-drop-indicator]");
    expect(indicator).toBeTruthy();
    expect(indicator!.style.left).toBe("20px"); // 70 - 50
    expect(indicator!.style.top).toBe("30px"); // 130 - 100
    expect(indicator!.style.width).toBe("60px");
    expect(indicator!.style.height).toBe("2px");
  });

  it("draws the drop indicator even with no hover and no selection", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(0, 0, 0, 0));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setDropIndicator({ left: 10, top: 10, width: 60, height: 2 });

    const { container } = render(<EmbedElementHighlight />);

    expect(container.querySelector("[data-embed-drop-indicator]")).toBeTruthy();
    expect(container.querySelector('[data-embed-element-box][data-kind="hover"]')).toBeNull();
    expect(container.querySelector('[data-embed-element-box][data-kind="selection"]')).toBeNull();
  });

  it("renders nothing once picking stops and the indicator is cleared", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(0, 0, 0, 0));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setDropIndicator({ left: 10, top: 10, width: 60, height: 2 });

    const { container, rerender } = render(<EmbedElementHighlight />);
    expect(container.querySelector("[data-embed-drop-indicator]")).toBeTruthy();

    act(() => useEmbedPickerStore.getState().stopPicking());
    rerender(<EmbedElementHighlight />);

    expect(container.querySelector("[data-embed-element-highlight]")).toBeNull();
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

  it("shows an agent button next to a selected embed element", () => {
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

    const { getByLabelText } = render(<EmbedElementHighlight />);
    expect(getByLabelText("Ask agent")).toBeTruthy();
  });

  // The trigger anchors on the picked ELEMENT's own top-right corner —
  // mirroring NodeAgentButton's anchor for a native node — not the embed
  // host's right edge. Host and element are given deliberately different
  // stubbed rects so this would fail under the old host-right-edge
  // behaviour.
  it("anchors the agent button at the picked element's top-right corner", () => {
    const { canvas } = mountEmbedDom();
    const canvasRect = rect(10, 20, 400, 300);
    const hostRect = rect(30, 40, 200, 150);
    const elementRect = rect(50, 60, 40, 20);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute("data-canvas")) return canvasRect;
      if (this.hasAttribute("data-embed-id")) return hostRect;
      return elementRect;
    });

    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const { getByLabelText } = render(<EmbedElementHighlight />);
    const wrapper = getByLabelText("Ask agent").closest("div.absolute") as HTMLElement;
    // Element's own top-right corner, canvas-relative: 50 + 40 - 10, 60 - 20.
    // The host's right edge (30 + 200 - 10 = 220) would have produced a
    // different, wrong x under the old behaviour.
    expect(wrapper.style.left).toBe(`${50 + 40 - 10}px`);
    expect(wrapper.style.top).toBe(`${60 - 20}px`);
    expect(canvas).toBeTruthy();
  });

  // The element rect is UNCLIPPED: a full-bleed element inside a clipped
  // embed reports a right edge past the host's own, which would strand the
  // trigger on empty canvas with nothing under it.
  it("clamps the agent button to the embed host's box when the element overflows it", () => {
    mountEmbedDom();
    const canvasRect = rect(10, 20, 400, 300);
    const hostRect = rect(30, 40, 100, 80);
    // Wider and taller than the host, and starting above it.
    const elementRect = rect(30, 10, 400, 400);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute("data-canvas")) return canvasRect;
      if (this.hasAttribute("data-embed-id")) return hostRect;
      return elementRect;
    });

    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > button:nth-of-type(1)",
      tagName: "button",
      classes: [],
      textPreview: "Buy",
      outerHtml: "<button>Buy</button>",
    });

    const { getByLabelText } = render(<EmbedElementHighlight />);
    const wrapper = getByLabelText("Ask agent").closest("div.absolute") as HTMLElement;
    // Host right edge (30 + 100 - 10 = 120), not the element's (30 + 400 - 10
    // = 420); host top (40 - 20 = 20), not the element's (10 - 20 = -10).
    expect(wrapper.style.left).toBe("120px");
    expect(wrapper.style.top).toBe("20px");
  });

  // PixiCanvas suppresses the embed-level agent button on this flag, not on
  // the picker selection — the two disagree whenever the picked element has
  // left the live shadow DOM with htmlContent untouched, and suppressing on
  // the selection alone left such an embed with no agent affordance at all.
  it("reports the element affordance as visible only while it is actually mounted", () => {
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

    const { unmount } = render(<EmbedElementHighlight />);
    expect(useEmbedPickerStore.getState().elementAffordanceVisible).toBe(true);

    unmount();
    expect(useEmbedPickerStore.getState().elementAffordanceVisible).toBe(false);
  });

  it("reports no affordance when the picked element can't be resolved in the live DOM", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(5, 5, 40, 20));

    // A path that matches nothing — the element the user picked is gone from
    // the shadow DOM even though the selection (and htmlContent) survive.
    useEmbedPickerStore.getState().selectElement({
      embedId: "embed1",
      path: "div:nth-of-type(1) > section:nth-of-type(9)",
      tagName: "section",
      classes: [],
      textPreview: "",
      outerHtml: "<section></section>",
    });

    const { queryByLabelText } = render(<EmbedElementHighlight />);
    expect(queryByLabelText("Ask agent")).toBeNull();
    expect(useEmbedPickerStore.getState().elementAffordanceVisible).toBe(false);
  });

  it("does not show an agent button while only hovering (no selection)", () => {
    mountEmbedDom();
    stubRects(rect(0, 0, 400, 300), rect(20, 10, 60, 24));

    useEmbedPickerStore.getState().startPicking("embed1");
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(1) > button:nth-of-type(1)");

    const { queryByLabelText } = render(<EmbedElementHighlight />);
    expect(queryByLabelText("Ask agent")).toBeNull();
  });

  it("opens the composer and sends through launchEmbedElementAgentChat with the embed id and text", () => {
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

    const { getByLabelText, getByRole } = render(<EmbedElementHighlight />);
    fireEvent.click(getByLabelText("Ask agent"));

    const textarea = getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe("Ask the agent about this element…");
    fireEvent.change(textarea, { target: { value: "Make this bigger" } });
    fireEvent.click(getByLabelText("Send"));

    expect(launchEmbedElementAgentChat).toHaveBeenCalledTimes(1);
    const [selectionArg, textArg] = vi.mocked(launchEmbedElementAgentChat).mock.calls[0];
    expect(selectionArg.embedId).toBe("embed1");
    expect(textArg).toBe("Make this bigger");
  });
});
