import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useLayers3DStore, DEFAULT_SPACING } from "@/store/layers3dStore";
import { Layers3DOverlay } from "../Layers3DOverlay";
import { Layers3DToggle } from "../Layers3DToggle";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";

const plane = (nodeId: string, depthIndex: number) => ({
  nodeId,
  depthIndex,
  rect: { x: 0, y: 0, width: 100, height: 50 },
  imageUrl: `blob:${nodeId}`,
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

  it("opts each plane out of max-width/height so its explicit px size wins", () => {
    // Regression: Tailwind preflight's `img { max-width: 100% }` resolves
    // against the absolutely-positioned (0-width) stack and collapses every
    // plane to 0px — making the whole 3D view invisible. The planes must
    // set max-width/max-height to "none".
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    const img = document.querySelector('img[data-plane-id="a"]') as HTMLElement;
    expect(img.style.maxWidth).toBe("none");
    expect(img.style.maxHeight).toBe("none");
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

  it("does not double-apply opacity — base is 1, only hover-dim reduces it", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0), plane("b", 1)] });
    render(<Layers3DOverlay />);
    const imgA = document.querySelector('img[data-plane-id="a"]') as HTMLElement;
    const imgB = document.querySelector('img[data-plane-id="b"]') as HTMLElement;
    expect(imgA.style.opacity).toBe("1");
    expect(imgB.style.opacity).toBe("1");
    fireEvent.pointerEnter(imgA);
    expect(imgA.style.opacity).toBe("1");
    expect(imgB.style.opacity).toBe("0.5");
  });
});

describe("Layers3DToggle", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetStores();
    seedScene();
    useLayers3DStore.setState({ active: false, planes: [] });
  });

  it("is disabled when no frame can be resolved", () => {
    resetStores(); // empty scene → no frame
    useSelectionStore.setState({ selectedIds: [] });
    render(<Layers3DToggle />);
    const button = screen.getByRole("button", { name: /3d/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enters 3D with the resolved frame on click", () => {
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    render(<Layers3DToggle />);
    fireEvent.click(screen.getByRole("button", { name: /3d/i }));
    expect(useLayers3DStore.getState().active).toBe(true);
    expect(useLayers3DStore.getState().targetFrameId).toBe("frame1");
  });

  it("re-enables when a frame is added to the scene, without remounting", () => {
    resetStores(); // empty scene → no frame at all
    useSelectionStore.setState({ selectedIds: [] });
    render(<Layers3DToggle />);
    const button = screen.getByRole("button", { name: /3d/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    act(() => {
      seedScene(); // adds frame1 to rootIds
    });
    // The toggle must pick this up via its own store subscription — nothing
    // else in this test re-renders it.
    expect(button.disabled).toBe(false);
  });
});
