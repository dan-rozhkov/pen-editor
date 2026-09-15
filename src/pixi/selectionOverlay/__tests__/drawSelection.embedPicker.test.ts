import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Container, Graphics } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { resetStores } from "@/test/fixtures";
import type { OverlayHelpers, Rect } from "@/pixi/selectionOverlay/helpers";
import { redrawSelection } from "@/pixi/selectionOverlay/drawSelection";

// A single selected embed's outline/handles are DOM-rendered elsewhere
// (EmbedSelectionFrame) — only the Pixi size badge is drawSelection.ts's own
// concern here, and it must disappear once an element inside that embed is
// picked (EmbedElementHighlight takes over showing that element's box).
describe("redrawSelection — single-embed size badge vs. a picked element", () => {
  beforeAll(() => {
    vi.stubGlobal("CanvasRenderingContext2D", class {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetStores();
    const embed = {
      id: "e1",
      type: "embed",
      name: "Embed",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      htmlContent: "<div>hi</div>",
    } as unknown as FlatSceneNode;
    useSceneStore.setState({
      nodesById: { e1: embed },
      parentById: { e1: null },
      childrenById: { e1: [] },
      rootIds: ["e1"],
      _cachedTree: null,
    });
    useSelectionStore.setState({ selectedIds: ["e1"] });
  });

  function draw() {
    const outlines = new Container();
    const handles = new Container();
    const sizeLabels = new Container();
    const devBadges = new Container();
    const helpers = {
      getNodeDrawRect: (id: string): Rect | null =>
        id === "e1" ? { x: 100, y: 100, width: 200, height: 100 } : null,
      getSelectionColor: () => 0x0d99ff,
    } as unknown as OverlayHelpers;
    // A Graphics instance (for the baselines param) that nothing here reads.
    const baselines = new Graphics();

    redrawSelection(outlines, handles, sizeLabels, devBadges, baselines, helpers);
    return { sizeLabels };
  }

  it("draws the size badge when no element is picked", () => {
    const { sizeLabels } = draw();
    expect(sizeLabels.children).toHaveLength(1);
  });

  it("hides the size badge once an element inside this same embed is picked", () => {
    useEmbedPickerStore.getState().selectElement({
      embedId: "e1",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "hi",
      outerHtml: "<div>hi</div>",
    });

    const { sizeLabels } = draw();
    expect(sizeLabels.children).toHaveLength(0);
  });

  it("keeps drawing the badge for a picked element that belongs to a DIFFERENT embed", () => {
    useEmbedPickerStore.getState().selectElement({
      embedId: "some-other-embed",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "hi",
      outerHtml: "<div>hi</div>",
    });

    const { sizeLabels } = draw();
    expect(sizeLabels.children).toHaveLength(1);
  });
});
