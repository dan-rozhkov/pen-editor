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
    componentArtifactsById: {},
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
      componentArtifactsById: {},
      _cachedTree: null,
    });
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="vis"]')).not.toBeNull();
    expect(container.querySelector('[data-embed-id="hid"]')).toBeNull();
    expect(container.querySelector('[data-embed-id="dis"]')).toBeNull();
  });

  it("removes the host when the embed node is deleted", () => {
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="e1"]')).not.toBeNull();
    act(() => {
      useSceneStore.setState({
        nodesById: {}, parentById: {}, childrenById: {}, rootIds: [],
        componentArtifactsById: {}, _cachedTree: null,
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
});
