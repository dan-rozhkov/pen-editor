import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function seedEmbed(): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1", type: "embed", name: "Code", x: 0, y: 0,
        width: 100, height: 80, htmlContent: "<p id='hello'>hi</p>",
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],

    _cachedTree: null,
  });
}

describe("<EmbedLayer />", () => {
  beforeEach(() => { resetStores(); seedEmbed(); });
  afterEach(() => cleanup());

  it("renders a shadow-DOM host per embed with mounted content", () => {
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    // A content container is mounted inside the shadow root carrying the markup.
    // (Assert on text, not a specific element: DOMPurify behaves differently
    // under happy-dom than in a real browser.)
    expect(host!.shadowRoot!.firstElementChild).not.toBeNull();
    expect(host!.shadowRoot!.textContent).toContain("hi");
  });

  it("is pointer-events:none by default and auto when active", () => {
    const { container } = render(<EmbedLayer />);
    const host = () => container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    expect(host().style.pointerEvents).toBe("none");
    act(() => { useSelectionStore.getState().setActiveEmbed("e1"); });
    expect(host().style.pointerEvents).toBe("auto");
  });

  it("does not render embeds hidden via visible:false or enabled:false", () => {
    useSceneStore.setState({
      nodesById: {
        vis: { id: "vis", type: "embed", name: "Vis", x: 0, y: 0, width: 50, height: 50, htmlContent: "<p>v</p>" } as unknown as FlatSceneNode,
        hid: { id: "hid", type: "embed", name: "Hid", x: 0, y: 0, width: 50, height: 50, htmlContent: "<p>h</p>", visible: false } as unknown as FlatSceneNode,
        dis: { id: "dis", type: "embed", name: "Dis", x: 0, y: 0, width: 50, height: 50, htmlContent: "<p>d</p>", enabled: false } as unknown as FlatSceneNode,
      },
      parentById: { vis: null, hid: null, dis: null },
      childrenById: {},
      rootIds: ["vis", "hid", "dis"],

      _cachedTree: null,
    });
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="vis"]')).not.toBeNull();
    expect(container.querySelector('[data-embed-id="hid"]')).toBeNull();
    expect(container.querySelector('[data-embed-id="dis"]')).toBeNull();
  });

  // A hidden/disabled frame takes its whole subtree off screen (Pixi
  // containment) — the DOM overlay must not keep an embed alive underneath a
  // frame the user just hid, since nothing else (Pixi isn't rendering this
  // node at all) would stop it from doing so.
  it("does not render an embed nested inside a hidden ancestor frame", () => {
    useSceneStore.setState({
      nodesById: {
        wrap: { id: "wrap", type: "frame", name: "Wrap", x: 0, y: 0, width: 200, height: 150, visible: false } as unknown as FlatSceneNode,
        inner: { id: "inner", type: "embed", name: "Inner", x: 0, y: 0, width: 50, height: 50, htmlContent: "<p>i</p>" } as unknown as FlatSceneNode,
      },
      parentById: { wrap: null, inner: "wrap" },
      childrenById: { wrap: ["inner"] },
      rootIds: ["wrap"],

      _cachedTree: null,
    });
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="inner"]')).toBeNull();
  });

  it("does not render an embed nested inside an ancestor frame disabled via enabled:false", () => {
    useSceneStore.setState({
      nodesById: {
        wrap: { id: "wrap", type: "frame", name: "Wrap", x: 0, y: 0, width: 200, height: 150, enabled: false } as unknown as FlatSceneNode,
        inner: { id: "inner", type: "embed", name: "Inner", x: 0, y: 0, width: 50, height: 50, htmlContent: "<p>i</p>" } as unknown as FlatSceneNode,
      },
      parentById: { wrap: null, inner: "wrap" },
      childrenById: { wrap: ["inner"] },
      rootIds: ["wrap"],

      _cachedTree: null,
    });
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="inner"]')).toBeNull();
  });

  it("still renders an embed nested inside a visible, enabled ancestor frame", () => {
    useSceneStore.setState({
      nodesById: {
        wrap: { id: "wrap", type: "frame", name: "Wrap", x: 0, y: 0, width: 200, height: 150 } as unknown as FlatSceneNode,
        inner: { id: "inner", type: "embed", name: "Inner", x: 0, y: 0, width: 50, height: 50, htmlContent: "<p>i</p>" } as unknown as FlatSceneNode,
      },
      parentById: { wrap: null, inner: "wrap" },
      childrenById: { wrap: ["inner"] },
      rootIds: ["wrap"],

      _cachedTree: null,
    });
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="inner"]')).not.toBeNull();
  });

  it("removes the host when the embed node is deleted", () => {
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="e1"]')).not.toBeNull();
    act(() => {
      useSceneStore.setState({
        nodesById: {}, parentById: {}, childrenById: {}, rootIds: [],
 _cachedTree: null,
      });
    });
    expect(container.querySelector('[data-embed-id="e1"]')).toBeNull();
  });

  it("shows only embeds belonging to the active slide while presenting", () => {
    useSceneStore.setState({
      nodesById: {
        frame: { id: "frame", type: "frame", x: 0, y: 0, width: 100, height: 80 },
        nested: { id: "nested", type: "embed", x: 0, y: 0, width: 100, height: 80, htmlContent: "<p>nested</p>" },
        root: { id: "root", type: "embed", x: 120, y: 0, width: 100, height: 80, htmlContent: "<p>root</p>" },
      } as never,
      parentById: { frame: null, nested: "frame", root: null },
      childrenById: { frame: ["nested"] },
      rootIds: ["frame", "root"],
      _cachedTree: null,
    });
    useEditorModeStore.setState({
      mode: "present",
      presentFrameIds: ["frame", "root"],
      presentIndex: 1,
    });

    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="root"]')).not.toBeNull();
    expect(container.querySelector('[data-embed-id="nested"]')).toBeNull();

    act(() => useEditorModeStore.setState({ presentIndex: 0 }));
    expect(container.querySelector('[data-embed-id="root"]')).toBeNull();
    expect(container.querySelector('[data-embed-id="nested"]')).not.toBeNull();
  });

  // An embed with no htmlContent yet gets the prompt composer instead of
  // the shadow-DOM host — see EmbedPromptHost's doc comment for why that has
  // to be a whole separate component rather than a mode inside EmbedHost.
  it("renders the prompt composer for an embed with empty htmlContent, not the shadow-DOM host", () => {
    // The preceding "presenting" test leaves editorModeStore in "present"
    // mode (it restores presentIndex but not mode) — reset explicitly so
    // this test's embed isn't filtered out by the present-mode active-slide
    // check regardless of run order.
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: {
        empty: { id: "empty", type: "embed", name: "Empty", x: 0, y: 0, width: 320, height: 200, htmlContent: "" } as unknown as FlatSceneNode,
      },
      parentById: { empty: null },
      childrenById: {},
      rootIds: ["empty"],
      _cachedTree: null,
    });

    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="empty"]');
    expect(host).not.toBeNull();
    expect(host!.hasAttribute("data-embed-prompt")).toBe(true);
    expect(host!.shadowRoot).toBeNull();
  });

  it("renders the shadow-DOM host, not the prompt composer, for an embed with real htmlContent", () => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]');
    expect(host).not.toBeNull();
    expect(host!.hasAttribute("data-embed-prompt")).toBe(false);
  });
});
