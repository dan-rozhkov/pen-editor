import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Container, Graphics } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedVariables } from "@/test/fixtures";
import { createPixiSync } from "../pixiSync";
import { makeThemeCollection } from "@/lib/variables/collections";
import type { FlatFrameNode, RectNode } from "@/types/scene";
import type { Variable, VariableCollection } from "@/types/variable";

function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The solid color the rect-bg Graphics was last filled with (as 0xRRGGBB), or undefined. */
function fillColorOf(root: Container, id: string): number | undefined {
  const gfx = root.getChildByLabel(id, true)?.getChildByLabel("rect-bg") as Graphics | null | undefined;
  const instructions = (gfx?.context as unknown as { instructions: Array<{ action: string; data: { style?: { color?: number } } }> })
    .instructions;
  const fills = instructions.filter((i) => i.action === "fill");
  return fills.at(-1)?.data.style?.color;
}

function seedScene(frameExtra: Partial<FlatFrameNode> = {}) {
  const frame = { id: "f", type: "frame", name: "F", x: 0, y: 0, width: 300, height: 300, ...frameExtra } as FlatFrameNode;
  const rect = {
    id: "r",
    type: "rect",
    name: "R",
    x: 10,
    y: 10,
    width: 50,
    height: 50,
    fill: "#000000",
    fillBinding: { variableId: "var-primary" },
  } as unknown as RectNode;
  useSceneStore.setState({
    nodesById: { f: frame, r: rect },
    parentById: { f: null, r: "f" },
    childrenById: { f: ["r"], r: [] },
    rootIds: ["f"],
    _cachedTree: null,
  });
}

describe("pixiSync: the document-level mode context reaches the canvas", () => {
  let root: Container;
  let dispose: () => void;

  beforeEach(() => {
    resetStores();
    seedVariables(); // var-primary: light #3366ff, dark #99bbff
    root = new Container();
  });
  afterEach(() => dispose?.());

  it("opens a dark document with bound nodes drawn dark, with no frame override", async () => {
    seedScene();
    useThemeStore.getState().setModeContext({ theme: "dark" });
    dispose = createPixiSync(root);
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x99bbff);
  });

  it("recolors bound nodes when the document mode context switches", async () => {
    seedScene();
    dispose = createPixiSync(root);
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x3366ff);

    useThemeStore.getState().setActiveTheme("dark");
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x99bbff);

    useThemeStore.getState().setModeContext({ theme: "light" });
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x3366ff);
  });

  it("a frame override still wins over the document context, and follows a modeOverrides change", async () => {
    seedScene({ modeOverrides: { theme: "light" } } as Partial<FlatFrameNode>);
    useThemeStore.getState().setModeContext({ theme: "dark" });
    dispose = createPixiSync(root);
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x3366ff);

    const frame = useSceneStore.getState().nodesById.f as FlatFrameNode;
    useSceneStore.setState({
      nodesById: { ...useSceneStore.getState().nodesById, f: { ...frame, modeOverrides: { theme: "dark" } } as FlatFrameNode },
    });
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x99bbff);
  });

  it("recolors for a non-Theme collection pick (Brand) at document level and on a frame", async () => {
    const brand: VariableCollection = {
      id: "brand",
      name: "Brand",
      modes: [
        { id: "acme", name: "Acme" },
        { id: "zen", name: "Zen" },
      ],
      defaultModeId: "acme",
    };
    const accent: Variable = {
      id: "var-primary",
      name: "--primary",
      type: "color",
      collectionId: "brand",
      valuesByMode: { acme: "#ff0000", zen: "#00ff00" },
      value: "#ff0000",
    };
    useVariableStore.getState().replaceAll([accent], [makeThemeCollection(), brand]);
    seedScene();
    dispose = createPixiSync(root);
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0xff0000);

    useThemeStore.getState().setCollectionMode("brand", "zen");
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0x00ff00);

    const frame = useSceneStore.getState().nodesById.f as FlatFrameNode;
    useSceneStore.setState({
      nodesById: { ...useSceneStore.getState().nodesById, f: { ...frame, modeOverrides: { brand: "acme" } } as FlatFrameNode },
    });
    await flushFrame();
    expect(fillColorOf(root, "r")).toBe(0xff0000);
  });
});
