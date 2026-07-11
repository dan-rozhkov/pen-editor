import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useLayers3DStore, DEFAULT_SPACING } from "@/store/layers3dStore";
import { Layers3DOverlay } from "../Layers3DOverlay";

const plane = (nodeId: string, depthIndex: number) => ({
  nodeId,
  depthIndex,
  rect: { x: 0, y: 0, width: 100, height: 50 },
  imageUrl: `blob:${nodeId}`,
  opacity: 1,
  cornerRadius: 4,
});

describe("Layers3DOverlay", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useLayers3DStore.setState({
      active: false, planes: [], hoveredPlaneId: null,
      rotateX: 8, rotateY: -24, spacing: DEFAULT_SPACING, zoom: 1,
    });
  });

  it("renders nothing when inactive", () => {
    const { container } = render(<Layers3DOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one img per plane with a translate3d transform", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0), plane("b", 1)] });
    render(<Layers3DOverlay />);
    const imgs = document.querySelectorAll("img[data-plane-id]");
    expect(imgs).toHaveLength(2);
    expect((imgs[1] as HTMLElement).style.transform).toContain("translate3d");
  });

  it("sets hoveredPlaneId on pointer enter", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    fireEvent.pointerEnter(document.querySelector('img[data-plane-id="a"]')!);
    expect(useLayers3DStore.getState().hoveredPlaneId).toBe("a");
  });

  it("spacing slider updates the store", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    fireEvent.change(screen.getByLabelText(/spacing/i), { target: { value: "120" } });
    expect(useLayers3DStore.getState().spacing).toBe(120);
  });
});
