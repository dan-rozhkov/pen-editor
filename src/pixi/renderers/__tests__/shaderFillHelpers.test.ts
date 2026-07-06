import { describe, it, expect } from "vitest";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  placeShaderSprite,
  shouldRebakeShader,
  destroyShaderFill,
  resizeShaderFill,
  isSizeOnlyShaderChange,
} from "../shaderFillHelpers";
import type { FlatSceneNode } from "@/types/scene";

function rectNode(over: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 100, height: 80, ...over } as FlatSceneNode;
}

describe("shaderFillHelpers", () => {
  it("inserts the shader sprite directly after the background graphic and below children", () => {
    const c = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    c.addChild(bg);
    const child = new Container();
    child.label = "child";
    c.addChild(child);

    const sprite = new Sprite(Texture.WHITE);
    placeShaderSprite(c, sprite, rectNode());

    const spriteIdx = c.getChildIndex(sprite);
    expect(spriteIdx).toBe(c.getChildIndex(bg) + 1);
    expect(spriteIdx).toBeLessThan(c.getChildIndex(child));
    expect(sprite.width).toBe(100);
    expect(sprite.height).toBe(80);
    expect(sprite.mask).toBeTruthy();
  });

  it("inserts above an existing image-fill sprite", () => {
    const c = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    c.addChild(bg);
    const imageFill = new Sprite(Texture.WHITE);
    imageFill.label = "image-fill";
    c.addChild(imageFill);

    const sprite = new Sprite(Texture.WHITE);
    placeShaderSprite(c, sprite, rectNode());

    expect(c.getChildIndex(sprite)).toBe(c.getChildIndex(imageFill) + 1);
  });

  it("destroyShaderFill removes the sprite and its mask", () => {
    const c = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    c.addChild(bg);
    placeShaderSprite(c, new Sprite(Texture.WHITE), rectNode());
    expect(c.getChildByLabel("shader-fill")).toBeTruthy();

    destroyShaderFill(c);
    expect(c.getChildByLabel("shader-fill")).toBeNull();
    expect(c.getChildByLabel("shader-mask")).toBeNull();
  });

  it("rebakes when shader ref, width, or height changes", () => {
    const s = { kind: "waves", params: {} } as FlatSceneNode["shader"];
    const base = rectNode({ shader: s });
    expect(shouldRebakeShader(base, rectNode({ shader: s }))).toBe(false);
    expect(shouldRebakeShader(rectNode({ shader: { kind: "waves", params: {} } }), base)).toBe(true);
    expect(shouldRebakeShader(rectNode({ shader: s, width: 200 }), base)).toBe(true);
    expect(shouldRebakeShader(rectNode({ shader: s, height: 200 }), base)).toBe(true);
  });

  it("rebakes when corner geometry changes (radius, per-corner, or smoothing)", () => {
    const s = { kind: "waves", params: {} } as FlatSceneNode["shader"];
    const base = rectNode({ shader: s, cornerRadius: 4 });
    expect(shouldRebakeShader(rectNode({ shader: s, cornerRadius: 8 }), base)).toBe(true);

    const perCorner = { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 };
    const baseWithPerCorner = rectNode({ shader: s, cornerRadiusPerCorner: perCorner });
    expect(
      shouldRebakeShader(
        rectNode({ shader: s, cornerRadiusPerCorner: { ...perCorner, topLeft: 10 } }),
        baseWithPerCorner,
      ),
    ).toBe(true);

    const baseWithSmoothing = rectNode({ shader: s, cornerSmoothing: 0.3 });
    expect(shouldRebakeShader(rectNode({ shader: s, cornerSmoothing: 0.6 }), baseWithSmoothing)).toBe(true);

    // Unchanged corner geometry: no rebake.
    expect(shouldRebakeShader(rectNode({ shader: s, cornerRadius: 4 }), base)).toBe(false);
  });

  it("rebakes when a hidden node becomes visible, but not while it stays hidden", () => {
    const s = { kind: "waves", params: {} } as FlatSceneNode["shader"];
    const hidden = rectNode({ shader: s, visible: false });
    const shown = rectNode({ shader: s, visible: true });
    // hidden -> visible: rebake so it bakes once shown
    expect(shouldRebakeShader(shown, hidden)).toBe(true);
    // visible -> hidden (nothing else changed): no rebake
    expect(shouldRebakeShader(hidden, shown)).toBe(false);
  });

  it("placeShaderSprite / resizeShaderFill use an explicit (effective) size", () => {
    const c = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    c.addChild(bg);
    const sprite = new Sprite(Texture.WHITE);
    // Effective size differs from stored node size (auto-layout frame case).
    placeShaderSprite(c, sprite, rectNode(), 250, 120);
    expect(sprite.width).toBe(250);
    expect(sprite.height).toBe(120);

    resizeShaderFill(c, rectNode({ shader: { kind: "waves", params: {} } }), 300, 90);
    const resized = c.getChildByLabel("shader-fill") as Sprite;
    expect(resized.width).toBe(300);
    expect(resized.height).toBe(90);
    expect(resized.mask).toBeTruthy();
  });

  describe("isSizeOnlyShaderChange", () => {
    const shader = { kind: "waves", params: {} } as FlatSceneNode["shader"];
    const base = rectNode({ shader });

    it("true when only width/height changed", () => {
      expect(isSizeOnlyShaderChange({ ...base, width: 200 }, base)).toBe(true);
      expect(isSizeOnlyShaderChange({ ...base, height: 120 }, base)).toBe(true);
    });

    it("false when the shader config changed", () => {
      const next = { ...base, width: 200, shader: { kind: "waves", params: {} } as FlatSceneNode["shader"] };
      expect(isSizeOnlyShaderChange(next, base)).toBe(false);
    });

    it("false when the node just became renderable (needs a real bake)", () => {
      const hidden = { ...base, visible: false };
      expect(isSizeOnlyShaderChange({ ...base, width: 200 }, hidden)).toBe(false);
    });

    it("false when nothing changed", () => {
      expect(isSizeOnlyShaderChange(base, base)).toBe(false);
    });
  });
});
