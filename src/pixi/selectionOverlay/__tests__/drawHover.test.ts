import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";
import { useDevModeStore } from "@/store/devModeStore";
import { useHoverStore } from "@/store/hoverStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { resetStores } from "@/test/fixtures";
import type { OverlayHelpers, Rect } from "@/pixi/selectionOverlay/helpers";
import {
  cleanupSpacingPool,
  redrawHover,
} from "@/pixi/selectionOverlay/drawHover";

describe("redrawHover dev-mode spacing", () => {
  beforeAll(() => {
    vi.stubGlobal("CanvasRenderingContext2D", class {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetStores();
    useDevModeStore.setState({ active: true });

    const frame = {
      id: "frame",
      type: "frame",
      name: "Auto layout frame",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      layout: {
        autoLayout: true,
        flexDirection: "row",
        gap: 10,
        paddingTop: 8,
        paddingRight: 8,
        paddingBottom: 8,
        paddingLeft: 8,
      },
    } as unknown as FlatSceneNode;
    const first = {
      id: "first",
      type: "rect",
      name: "First",
      x: 8,
      y: 8,
      width: 80,
      height: 84,
    } as unknown as FlatSceneNode;
    const second = {
      id: "second",
      type: "rect",
      name: "Second",
      x: 98,
      y: 8,
      width: 80,
      height: 84,
    } as unknown as FlatSceneNode;

    useSceneStore.setState({
      nodesById: { frame, first, second },
      parentById: { frame: null, first: "frame", second: "frame" },
      childrenById: { frame: ["first", "second"], first: [], second: [] },
      rootIds: ["frame"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    useHoverStore.getState().setHoveredNode("frame");
  });

  afterEach(() => {
    cleanupSpacingPool();
    useHoverStore.getState().clearHovered();
    useDevModeStore.setState({ active: false });
  });

  it("draws hovered frame padding and gap without selecting it", () => {
    useSelectionStore.getState().select("first");
    const rects: Record<string, Rect> = {
      frame: { x: 100, y: 100, width: 200, height: 100 },
      first: { x: 108, y: 108, width: 80, height: 84 },
      second: { x: 198, y: 108, width: 80, height: 84 },
    };
    const helpers = {
      getNodeDrawRect: (id: string) => rects[id] ?? null,
      getSelectionColor: () => 0x0d99ff,
      isInComponentContext: () => false,
    } as unknown as OverlayHelpers;
    const hoverOutline = new Graphics();
    const childOutlines = new Graphics();
    const hoverTextBaselines = new Graphics();
    const spacingOverlay = new Container();
    const spacingLabel = new Container();

    redrawHover(
      hoverOutline,
      childOutlines,
      hoverTextBaselines,
      spacingOverlay,
      spacingLabel,
      helpers,
    );

    expect(spacingOverlay.children).toHaveLength(1);
    expect(spacingLabel.children).toHaveLength(5);
    expect(hoverOutline.context.instructions.find((item) => item.action === "stroke")?.data.style.color)
      .toBe(0xf24822);
  });

  it("outlines a different hovered node with the measure color", () => {
    useSelectionStore.getState().select("first");
    useHoverStore.getState().setHoveredNode("second");

    const helpers = {
      getNodeDrawRect: (id: string) => ({
        first: { x: 108, y: 108, width: 80, height: 84 },
        second: { x: 198, y: 108, width: 80, height: 84 },
      })[id] ?? null,
      isInComponentContext: () => false,
    } as unknown as OverlayHelpers;
    const hoverOutline = new Graphics();

    redrawHover(
      hoverOutline,
      new Graphics(),
      new Graphics(),
      new Container(),
      new Container(),
      helpers,
    );

    expect(hoverOutline.context.instructions.find((item) => item.action === "stroke")?.data.style.color)
      .toBe(0xf24822);
  });

  it("keeps the normal edit-mode hover color unchanged", () => {
    useDevModeStore.setState({ active: false });
    useSelectionStore.getState().select("first");
    useHoverStore.getState().setHoveredNode("second");
    const hoverOutline = new Graphics();

    redrawHover(
      hoverOutline,
      new Graphics(),
      new Graphics(),
      new Container(),
      new Container(),
      {
        getNodeDrawRect: () => ({ x: 198, y: 108, width: 80, height: 84 }),
        isInComponentContext: () => false,
      } as unknown as OverlayHelpers,
    );

    const stroke = hoverOutline.context.instructions.find(
      (item) => item.action === "stroke",
    )?.data.style;
    expect(stroke?.color).toBe(0x0d99ff);
    expect(stroke?.width).toBe(2);
  });

  it("keeps the native-node hover outline at two screen pixels when zoomed", () => {
    useDevModeStore.setState({ active: false });
    useViewportStore.setState({ scale: 2 });
    useHoverStore.getState().setHoveredNode("second");
    const hoverOutline = new Graphics();

    redrawHover(
      hoverOutline,
      new Graphics(),
      new Graphics(),
      new Container(),
      new Container(),
      {
        getNodeDrawRect: () => ({ x: 198, y: 108, width: 80, height: 84 }),
        isInComponentContext: () => false,
      } as unknown as OverlayHelpers,
    );

    expect(hoverOutline.context.instructions.find(
      (item) => item.action === "stroke",
    )?.data.style.width).toBe(1);
  });

  it("keeps the component-descendant hover outline at two screen pixels when zoomed", () => {
    useDevModeStore.setState({ active: false });
    useViewportStore.setState({ scale: 2 });
    useHoverStore.getState().setHoveredDescendant("instance", "child");
    const hoverOutline = new Graphics();

    redrawHover(
      hoverOutline,
      new Graphics(),
      new Graphics(),
      new Container(),
      new Container(),
      {
        getInstanceDescendantTarget: () => ({
          instance: { id: "instance", type: "ref" },
          node: { id: "child", type: "rect" },
          drawRect: { x: 20, y: 30, width: 40, height: 50 },
        }),
      } as unknown as OverlayHelpers,
    );

    const stroke = hoverOutline.context.instructions.find(
      (item) => item.action === "stroke",
    )?.data.style;
    expect(stroke?.color).toBe(0x8b5cf6);
    expect(stroke?.width).toBe(1);
  });
});
