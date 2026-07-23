import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EmbedSelectionFrame } from "../EmbedSelectionFrame";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";

const embed = {
  id: "e1",
  type: "embed",
  name: "Card",
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  htmlContent: "<div></div>",
} as unknown as EmbedNode;

describe("<EmbedSelectionFrame />", () => {
  beforeEach(() => {
    resetStores();
    useSceneStore.setState({
      nodesById: { e1: embed as unknown as FlatSceneNode },
      parentById: { e1: null },
      childrenById: { e1: [] },
      rootIds: ["e1"],
    });
  });

  afterEach(() => cleanup());

  it("positions the frame over the embed screen rect and draws 4 corner handles", () => {
    useViewportStore.setState({ scale: 2, x: 50, y: 30 });

    const { container } = render(
      <EmbedSelectionFrame node={embed} absoluteX={10} absoluteY={20} />,
    );

    const frame = container.querySelector(
      "[data-embed-selection-frame]",
    ) as HTMLElement;
    expect(frame).toBeTruthy();

    // screen rect (dpr=1): left = 10*2+50 = 70, top = 20*2+30 = 70,
    // width = 200*2 = 400, height = 120*2 = 240
    expect(frame.style.left).toBe("70px");
    expect(frame.style.top).toBe("70px");
    expect(frame.style.width).toBe("400px");
    expect(frame.style.height).toBe("240px");

    const handles = frame.querySelectorAll("[data-embed-selection-handle]");
    expect(handles.length).toBe(4);

    // default selection color (rendered on the outline border)
    const outline = frame.querySelector(
      "[data-embed-selection-outline]",
    ) as HTMLElement;
    expect(outline.style.borderColor).toBe("#0d99ff");
    expect(outline.style.borderWidth).toBe("1px");
  });

  it("is non-interactive so pointer events reach the Pixi canvas underneath", () => {
    const { container } = render(
      <EmbedSelectionFrame node={embed} absoluteX={0} absoluteY={0} />,
    );
    const frame = container.querySelector(
      "[data-embed-selection-frame]",
    ) as HTMLElement;
    expect(frame.style.pointerEvents).toBe("none");
  });

  it("supports a 2px hover outline without transform handles", () => {
    const { container } = render(
      <EmbedSelectionFrame
        node={embed}
        absoluteX={0}
        absoluteY={0}
        outlineStrokeWidth={2}
        showHandles={false}
      />,
    );
    const outline = container.querySelector(
      "[data-embed-selection-outline]",
    ) as HTMLElement;
    expect(outline.style.borderWidth).toBe("2px");
    expect(container.querySelectorAll("[data-embed-selection-handle]")).toHaveLength(0);
  });

  it("uses the component selection color when the embed is inside a component", () => {
    const reusableFrame = {
      id: "comp",
      type: "frame",
      name: "Component",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      reusable: true,
    } as unknown as FlatSceneNode;
    useSceneStore.setState({
      nodesById: { comp: reusableFrame, e1: embed as unknown as FlatSceneNode },
      parentById: { comp: null, e1: "comp" },
      childrenById: { comp: ["e1"], e1: [] },
      rootIds: ["comp"],
    });

    const { container } = render(
      <EmbedSelectionFrame node={embed} absoluteX={0} absoluteY={0} />,
    );
    const frame = container.querySelector(
      "[data-embed-selection-frame]",
    ) as HTMLElement;
    // component selection color (rendered on the outline border)
    const outline = frame.querySelector(
      "[data-embed-selection-outline]",
    ) as HTMLElement;
    expect(outline.style.borderColor).toBe("#8b5cf6");
  });
});
