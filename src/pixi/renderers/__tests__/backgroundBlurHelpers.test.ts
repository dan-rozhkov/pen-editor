import { describe, it, expect, vi, afterEach } from "vitest";
import { Container, Graphics, Sprite, Texture, TextureSource } from "pixi.js";
import {
  placeBackgroundBlurSprite,
  shouldRebakeBackgroundBlur,
  isSizeOnlyBackgroundBlurChange,
  destroyBackgroundBlurFill,
  scheduleBackgroundBlurRebake,
  ensureBackgroundBlurDestroyHook,
} from "../backgroundBlurHelpers";
import type { Effect, FlatSceneNode } from "@/types/scene";

function rectNode(over: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 100, height: 80, ...over } as FlatSceneNode;
}

describe("backgroundBlurHelpers", () => {
  it("inserts the backdrop sprite as the very first child, below any existing background/children", () => {
    const c = new Container();
    const bg = new Graphics();
    bg.label = "rect-bg";
    c.addChild(bg);
    const child = new Container();
    child.label = "child";
    c.addChild(child);

    const sprite = new Sprite(Texture.WHITE);
    placeBackgroundBlurSprite(c, sprite, rectNode());

    expect(c.getChildIndex(sprite)).toBe(0);
    expect(c.getChildIndex(sprite)).toBeLessThan(c.getChildIndex(bg));
    expect(sprite.width).toBe(100);
    expect(sprite.height).toBe(80);
    expect(sprite.mask).toBeTruthy();
  });

  it("uses an explicit (effective) size when given", () => {
    const c = new Container();
    const sprite = new Sprite(Texture.WHITE);
    placeBackgroundBlurSprite(c, sprite, rectNode(), 250, 120);
    expect(sprite.width).toBe(250);
    expect(sprite.height).toBe(120);
  });

  it("destroyBackgroundBlurFill removes the sprite and its mask", () => {
    const c = new Container();
    placeBackgroundBlurSprite(c, new Sprite(Texture.WHITE), rectNode());
    expect(c.getChildByLabel("background-blur-fill")).toBeTruthy();

    destroyBackgroundBlurFill(c);
    expect(c.getChildByLabel("background-blur-fill")).toBeNull();
    expect(c.getChildByLabel("background-blur-mask")).toBeNull();
  });

  describe("destroy teardown (bug-07: baked texture + rebake timer leak)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("frees the baked texture when the container is destroyed", () => {
      const c = new Container();
      const source = new TextureSource({ width: 4, height: 4 });
      const texture = new Texture({ source });
      placeBackgroundBlurSprite(c, new Sprite(texture), rectNode());

      ensureBackgroundBlurDestroyHook(c);
      expect(texture.destroyed).toBe(false);

      c.destroy({ children: true });

      expect(texture.destroyed).toBe(true);
    });

    it("cancels a pending debounced rebake timer when the container is destroyed", () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const c = new Container();
      const effects = [{ type: "background-blur", radius: 8 }] as Effect[];

      scheduleBackgroundBlurRebake(c, rectNode(), effects);
      ensureBackgroundBlurDestroyHook(c);

      c.destroy({ children: true });

      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Advancing time past the debounce must not throw / touch a destroyed container.
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    });

    it("does not attach the destroy hook twice for the same container", () => {
      const c = new Container();
      ensureBackgroundBlurDestroyHook(c);
      ensureBackgroundBlurDestroyHook(c);

      expect(() => c.destroy({ children: true })).not.toThrow();
    });
  });

  describe("shouldRebakeBackgroundBlur", () => {
    it("rebakes when the effect stack changes", () => {
      const base = rectNode({ effects: [{ type: "background-blur", radius: 8 }] });
      expect(
        shouldRebakeBackgroundBlur(
          rectNode({ effects: [{ type: "background-blur", radius: 16 }] }),
          base,
        ),
      ).toBe(true);
      expect(shouldRebakeBackgroundBlur(base, base)).toBe(false);
    });

    it("rebakes when width or height changes", () => {
      const base = rectNode();
      expect(shouldRebakeBackgroundBlur({ ...base, width: 200 }, base)).toBe(true);
      expect(shouldRebakeBackgroundBlur({ ...base, height: 200 }, base)).toBe(true);
    });

    it("rebakes when corner geometry changes", () => {
      const base = rectNode({ cornerRadius: 4 });
      expect(shouldRebakeBackgroundBlur(rectNode({ cornerRadius: 8 }), base)).toBe(true);
      expect(shouldRebakeBackgroundBlur(rectNode({ cornerRadius: 4 }), base)).toBe(false);
    });

    it("rebakes when a hidden node becomes visible, but not while it stays hidden", () => {
      const hidden = rectNode({ visible: false });
      const shown = rectNode({ visible: true });
      expect(shouldRebakeBackgroundBlur(shown, hidden)).toBe(true);
      expect(shouldRebakeBackgroundBlur(hidden, shown)).toBe(false);
    });
  });

  describe("isSizeOnlyBackgroundBlurChange", () => {
    const effects = [{ type: "background-blur", radius: 8 }] as FlatSceneNode["effects"];
    const base = rectNode({ effects });

    it("true when only width/height changed", () => {
      expect(isSizeOnlyBackgroundBlurChange({ ...base, width: 200 }, base)).toBe(true);
      expect(isSizeOnlyBackgroundBlurChange({ ...base, height: 120 }, base)).toBe(true);
    });

    it("false when the effect stack changed", () => {
      const next = {
        ...base,
        width: 200,
        effects: [{ type: "background-blur", radius: 16 }] as FlatSceneNode["effects"],
      };
      expect(isSizeOnlyBackgroundBlurChange(next, base)).toBe(false);
    });

    it("false when the shape (corner radius) changed", () => {
      expect(
        isSizeOnlyBackgroundBlurChange(rectNode({ effects, width: 200, cornerRadius: 12 }), base),
      ).toBe(false);
    });

    it("false when the node just became renderable (needs a full rebake)", () => {
      const hidden = { ...base, visible: false };
      expect(isSizeOnlyBackgroundBlurChange({ ...base, width: 200 }, hidden)).toBe(false);
    });

    it("false when nothing changed", () => {
      expect(isSizeOnlyBackgroundBlurChange(base, base)).toBe(false);
    });
  });
});
