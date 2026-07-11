import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  useLayers3DStore,
  DEFAULT_ROTATE_X,
  DEFAULT_ROTATE_Y,
  DEFAULT_SPACING,
} from "@/store/layers3dStore";
import { Layers3DOverlay } from "../Layers3DOverlay";
import { Layers3DToggle } from "../Layers3DToggle";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";

const plane = (nodeId: string, depth: number) => ({
  nodeId,
  depth,
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
      rotateX: DEFAULT_ROTATE_X,
      rotateY: DEFAULT_ROTATE_Y,
      spacing: DEFAULT_SPACING,
      zoom: 1,
    });
  });

  it("renders nothing when inactive", () => {
    const { container } = render(<Layers3DOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a loader while the frame is being captured", () => {
    useLayers3DStore.setState({ active: true, isLoading: true, planes: [] });
    render(<Layers3DOverlay />);

    expect(document.querySelector("[data-3d-loading]")).toBeTruthy();
    expect(document.querySelector("[data-3d-stack]")).toBeTruthy();
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

  it("places child planes closer to the viewer than their parents", () => {
    // depth is tree depth from the exploded frame root. A higher depth is a
    // deeper descendant, which must render CLOSER to the viewer (larger Z).
    useLayers3DStore.setState({
      active: true,
      planes: [plane("parent", 0), plane("child", 1)],
    });
    render(<Layers3DOverlay />);
    const zOf = (id: string) => {
      const t = (
        document.querySelector(`img[data-plane-id="${id}"]`) as HTMLElement
      ).style.transform;
      const m = t.match(/translate3d\([^,]+,[^,]+,\s*([-\d.]+)px\)/);
      return Number(m![1]);
    };
    expect(zOf("child")).toBeGreaterThan(zOf("parent"));
  });

  it("offsets each plane by the bounding-box min so the stack is centered", () => {
    // A child may sit at a negative offset relative to the frame origin. Plane
    // positions must be shifted by the bbox min so the wrapper's
    // translate(-50%,-50%) centers the true bounds, not the frame origin.
    useLayers3DStore.setState({
      active: true,
      planes: [
        { nodeId: "a", depth: 0, rect: { x: -30, y: -10, width: 100, height: 50 }, imageUrl: "blob:a", cornerRadius: 0 },
        { nodeId: "b", depth: 1, rect: { x: 0, y: 0, width: 100, height: 50 }, imageUrl: "blob:b", cornerRadius: 0 },
      ],
    });
    render(<Layers3DOverlay />);
    const xOf = (id: string) => {
      const t = (document.querySelector(`img[data-plane-id="${id}"]`) as HTMLElement).style.transform;
      return Number(t.match(/translate3d\(\s*([-\d.]+)px/)![1]);
    };
    // bbox.minX = -30 → plane "a" lands at x 0, plane "b" at x 30.
    expect(xOf("a")).toBe(0);
    expect(xOf("b")).toBe(30);
  });

  it("gives the wrapper explicit width/height equal to the bbox size", () => {
    useLayers3DStore.setState({
      active: true,
      planes: [
        { nodeId: "a", depth: 0, rect: { x: -30, y: -10, width: 100, height: 50 }, imageUrl: "blob:a", cornerRadius: 0 },
        { nodeId: "b", depth: 1, rect: { x: 0, y: 0, width: 100, height: 80 }, imageUrl: "blob:b", cornerRadius: 0 },
      ],
    });
    render(<Layers3DOverlay />);
    const wrapper = document.querySelector('[data-3d-stack]') as HTMLElement;
    // bbox: minX -30, maxX 100 → w 130; minY -10, maxY 80 → h 90.
    expect(wrapper.style.width).toBe("130px");
    expect(wrapper.style.height).toBe("90px");
  });

  it("falls back to baseScale 1 when the container measures 0 (happy-dom)", () => {
    // getBoundingClientRect returns 0-size in happy-dom, so the fit-scale must
    // degrade to 1 and not blow up (no scale(0), no NaN).
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)], zoom: 1 });
    render(<Layers3DOverlay />);
    const wrapper = document.querySelector('[data-3d-stack]') as HTMLElement;
    expect(wrapper.style.transform).toContain("scale(1)");
  });

  it("gives sibling planes (same depth) the same Z", () => {
    useLayers3DStore.setState({
      active: true,
      planes: [plane("a", 1), plane("b", 1), plane("root", 0)],
    });
    render(<Layers3DOverlay />);
    const zOf = (id: string) => {
      const t = (
        document.querySelector(`img[data-plane-id="${id}"]`) as HTMLElement
      ).style.transform;
      const m = t.match(/translate3d\([^,]+,[^,]+,\s*([-\d.]+)px\)/);
      return Number(m![1]);
    };
    expect(zOf("a")).toBe(zOf("b"));
    expect(zOf("a")).toBeGreaterThan(zOf("root"));
  });

  it("has no box-shadow and a light-blue outline on every plane, stronger on hover", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0), plane("b", 1)] });
    render(<Layers3DOverlay />);
    const imgA = document.querySelector('img[data-plane-id="a"]') as HTMLElement;
    const imgB = document.querySelector('img[data-plane-id="b"]') as HTMLElement;
    expect(imgA.style.boxShadow).toBe("");
    expect(imgB.style.boxShadow).toBe("");
    expect(imgA.style.outline).not.toBe("none");
    expect(imgA.style.outline).toContain("rgba(125, 196, 255");
    expect(imgB.style.outline).not.toBe("none");
    expect(imgB.style.outline).toContain("rgba(125, 196, 255");

    fireEvent.pointerEnter(imgA);
    // Hover strengthens the outline (higher alpha) without dropping it.
    expect(imgA.style.outline).toContain("0.95");
  });

  it("sets hoveredPlaneId on pointer enter", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    const img = document.querySelector('img[data-plane-id="a"]')! as HTMLElement;
    const transform = img.style.transform;
    fireEvent.pointerEnter(img);
    expect(useLayers3DStore.getState().hoveredPlaneId).toBe("a");
    expect(img.style.transform).toBe(transform);
  });

  it("spacing slider updates the store", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    const previousEvent = (globalThis as { event?: Event }).event;
    Object.defineProperty(globalThis, "event", {
      configurable: true,
      value: new Event("change"),
    });
    fireEvent.change(screen.getByLabelText(/spacing/i), { target: { value: "120" } });
    if (previousEvent) {
      Object.defineProperty(globalThis, "event", {
        configurable: true,
        value: previousEvent,
      });
    } else {
      delete (globalThis as { event?: Event }).event;
    }
    expect(useLayers3DStore.getState().spacing).toBe(120);
  });

  it("zooms three times faster per wheel delta", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)], zoom: 1 });
    render(<Layers3DOverlay />);
    const overlay = document.querySelector("[data-3d-stack]")!.parentElement!;
    fireEvent.wheel(overlay, { deltaY: -100 });
    expect(useLayers3DStore.getState().zoom).toBeCloseTo(1.3);
  });

  it("exits from the icon-only close button", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    fireEvent.click(screen.getByRole("button", { name: "Exit 3D view" }));
    expect(useLayers3DStore.getState().active).toBe(false);
  });

  it("resets the view from the icon-only reset button", () => {
    useLayers3DStore.setState({
      active: true,
      planes: [plane("a", 0)],
      rotateX: 30,
      rotateY: -40,
      spacing: 120,
      zoom: 2,
    });
    render(<Layers3DOverlay />);
    fireEvent.click(screen.getByRole("button", { name: "Reset 3D view" }));
    expect(useLayers3DStore.getState()).toMatchObject({
      rotateX: DEFAULT_ROTATE_X,
      rotateY: DEFAULT_ROTATE_Y,
      spacing: DEFAULT_SPACING,
      zoom: 1,
    });
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
