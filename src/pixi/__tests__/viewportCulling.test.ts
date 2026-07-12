import { BlurFilter, Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import {
  applyOverviewEffectVisibility,
  computeViewportRenderability,
} from "../viewportCulling";

const node = (
  id: string,
  type: FlatSceneNode["type"],
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<FlatSceneNode> = {},
): FlatSceneNode => ({ id, type, x, y, width, height, ...extra } as FlatSceneNode);

describe("computeViewportRenderability", () => {
  it("culls an off-screen nested subtree using accumulated parent coordinates", () => {
    const nodesById = {
      root: node("root", "frame", 100, 100, 2000, 1000),
      nearby: node("nearby", "frame", 20, 20, 100, 100),
      distant: node("distant", "frame", 1500, 20, 300, 300),
      leaf: node("leaf", "rect", 10, 10, 20, 20),
    };

    const result = computeViewportRenderability({
      rootIds: ["root"],
      nodesById,
      childrenById: { root: ["nearby", "distant"], distant: ["leaf"] },
      bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
      scale: 1,
      margin: 0,
    });

    expect(result.get("root")).toBe(true);
    expect(result.get("nearby")).toBe(true);
    expect(result.get("distant")).toBe(false);
    expect(result.has("leaf")).toBe(false);
  });

  it("omits tiny text details at overview scale without hiding mask nodes", () => {
    const nodesById = {
      root: node("root", "frame", 0, 0, 500, 500),
      tiny: node("tiny", "text", 10, 10, 100, 20),
      readable: node("readable", "text", 10, 40, 100, 40),
      mask: node("mask", "text", 10, 80, 100, 10, { isMask: true }),
    };

    const result = computeViewportRenderability({
      rootIds: ["root"],
      nodesById,
      childrenById: { root: ["tiny", "readable", "mask"] },
      bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
      scale: 0.1,
      margin: 0,
    });

    expect(result.get("tiny")).toBe(false);
    expect(result.get("readable")).toBe(true);
    expect(result.get("mask")).toBe(true);
  });

  it("keeps rotated subtrees renderable when axis-aligned scene coordinates are unsafe", () => {
    const nodesById = {
      rotated: node("rotated", "frame", 700, 0, 300, 300, { rotation: 45 }),
      child: node("child", "rect", 0, 0, 20, 20),
    };

    const result = computeViewportRenderability({
      rootIds: ["rotated"],
      nodesById,
      childrenById: { rotated: ["child"] },
      bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 },
      scale: 1,
      margin: 0,
    });

    expect(result.get("rotated")).toBe(true);
    expect(result.get("child")).toBe(true);
  });

  it("temporarily disables renderer-owned effects and restores them after overview", () => {
    const container = new Container();
    const shadow = new Container({ label: "shadow-layer" });
    const backdrop = new Sprite({ label: "background-blur-fill" });
    const blur = new BlurFilter() as BlurFilter & { __layerBlur?: true };
    blur.__layerBlur = true;
    container.addChild(shadow, backdrop);
    container.filters = [blur];

    applyOverviewEffectVisibility(container, true);
    expect(shadow.renderable).toBe(false);
    expect(backdrop.renderable).toBe(false);
    expect(blur.enabled).toBe(false);

    applyOverviewEffectVisibility(container, false);
    expect(shadow.renderable).toBe(true);
    expect(backdrop.renderable).toBe(true);
    expect(blur.enabled).toBe(true);
  });
});
