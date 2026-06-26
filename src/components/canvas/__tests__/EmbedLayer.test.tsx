import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
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
});
