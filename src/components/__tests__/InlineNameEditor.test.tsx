import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { InlineNameEditor } from "../InlineNameEditor";
import { useViewportStore } from "@/store/viewportStore";
import { resetStores } from "@/test/fixtures";
import {
  LABEL_FONT_SIZE,
  LABEL_OFFSET_Y,
} from "@/pixi/selectionOverlay/constants";
import type { FlatSceneNode } from "@/types/scene";

/**
 * The inline name editor (edit mode) must sit at exactly the same on-screen
 * position as the Pixi-rendered frame name label (view mode). Both derive their
 * vertical offset from the SAME constants in selectionOverlay/constants.ts;
 * if the editor hard-codes its own copy, the label visibly jumps when editing.
 *
 * Pixi label screen top (see drawFrameNames.ts): the label is drawn
 *   worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale
 * above node.y, so its screen-space top is
 *   absoluteY * scale + y - (LABEL_FONT_SIZE + LABEL_OFFSET_Y)
 */
describe("InlineNameEditor position", () => {
  beforeEach(() => {
    resetStores();
  });
  afterEach(() => {
    cleanup();
  });

  const node: FlatSceneNode = {
    id: "f1",
    type: "frame",
    name: "Frame",
    x: 100,
    y: 200,
    width: 300,
    height: 150,
  } as unknown as FlatSceneNode;

  it("positions the input at the same screen-Y as the Pixi frame label", () => {
    const scale = 1.5;
    const panX = 40;
    const panY = 60;
    useViewportStore.setState({ scale, x: panX, y: panY });

    const absoluteX = node.x;
    const absoluteY = node.y;

    const { container } = render(
      <InlineNameEditor node={node} absoluteX={absoluteX} absoluteY={absoluteY} />,
    );

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    const expectedTop =
      absoluteY * scale + panY - (LABEL_FONT_SIZE + LABEL_OFFSET_Y);
    const expectedLeft = absoluteX * scale + panX;

    expect(input!.style.top).toBe(`${expectedTop}px`);
    expect(input!.style.left).toBe(`${expectedLeft}px`);
  });
});
