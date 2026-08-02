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

  it("finding A: padding band geometry follows content insets (padding + inside stroke), label keeps the raw padding value", () => {
    // Same frame as the top-of-file fixture, but with a 10px inside stroke —
    // content (and thus the top band) starts 8 (padding) + 10 (stroke) = 18px
    // in, even though the user-set padding value shown on the label is still 8.
    const strokedFrame = {
      ...useSceneStore.getState().nodesById["frame"],
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
    } as unknown as FlatSceneNode;
    useSceneStore.setState({
      nodesById: { ...useSceneStore.getState().nodesById, frame: strokedFrame },
      _cachedTree: null,
    });
    useSelectionStore.getState().select("first");

    const rects: Record<string, Rect> = {
      frame: { x: 100, y: 100, width: 200, height: 100 },
      first: { x: 118, y: 118, width: 80, height: 74 },
      second: { x: 100, y: 100, width: 0, height: 0 },
    };
    const helpers = {
      getNodeDrawRect: (id: string) => rects[id] ?? null,
      getSelectionColor: () => 0x0d99ff,
      isInComponentContext: () => false,
    } as unknown as OverlayHelpers;
    const spacingOverlay = new Container();
    const spacingLabel = new Container();

    redrawHover(
      new Graphics(),
      new Graphics(),
      new Graphics(),
      spacingOverlay,
      spacingLabel,
      helpers,
    );

    // Dev Mode is active (from beforeEach) => persistent labels; the first
    // label (top padding band) must still read "8" — the property value.
    const topLabelText = (spacingLabel.children[0] as unknown as {
      children: { text?: string }[];
    }).children.find((c) => typeof c.text === "string")?.text;
    expect(topLabelText).toBe("8");

    // The painted band, however, must be 18px tall (padding 8 + stroke 10),
    // not 8px — read it back from the pooled Graphics' recorded rect instruction.
    const gfx = spacingOverlay.children[0] as Graphics;
    const firstRectInstruction = gfx.context.instructions.find(
      (i) => i.action === "fill",
    );
    type RectPathInstruction = { action: string; data: unknown[] };
    const path = (
      firstRectInstruction as unknown as { data: { path: { instructions: RectPathInstruction[] } } }
    ).data.path;
    const rectData = path.instructions[0].data;
    // gfx.rect(x, y, width, height, ...) — height is index 3.
    expect(rectData[3]).toBe(18);
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
