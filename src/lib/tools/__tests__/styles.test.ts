import { describe, it, expect, beforeEach } from "vitest";
import { getStyles } from "@/lib/tools/getStyles";
import { setStyles, normalizePaint } from "@/lib/tools/setStyles";
import { applyFillStyle } from "@/lib/tools/applyFillStyle";
import { applyEffectStyle } from "@/lib/tools/applyEffectStyle";
import { useStyleStore } from "@/store/styleStore";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import type { RectNode } from "@/types/scene";
import { resetStores, seedScene, seedFillStyles, seedEffectStyles } from "@/test/fixtures";

function rect1(): RectNode {
  return useSceneStore.getState().nodesById["rect1"] as unknown as RectNode;
}

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("normalizePaint (shape inference)", () => {
  it("solid: {color} shorthand and explicit type both yield a solid", () => {
    expect(normalizePaint({ color: "#abcdef" })).toEqual({
      paint: { id: expect.any(String), type: "solid", color: "#abcdef" },
    });
    expect(normalizePaint({ type: "solid", color: "#123456" })).toMatchObject({
      paint: { type: "solid", color: "#123456" },
    });
  });

  it("gradient: inferred from the {gradient} shape without an explicit type", () => {
    const result = normalizePaint({
      gradient: {
        type: "linear",
        stops: [{ color: "#000", position: 0 }, { color: "#fff", position: 1 }],
        startX: 0,
        startY: 0,
        endX: 1,
        endY: 1,
      },
    });
    expect("paint" in result && result.paint.type).toBe("gradient");
  });

  it("image and pattern: inferred from their sub-object shape", () => {
    const img = normalizePaint({ image: { url: "https://x/y.png", mode: "fill" } });
    expect("paint" in img && img.paint.type).toBe("image");
    const pat = normalizePaint({ pattern: { url: "https://x/t.png" } });
    expect("paint" in pat && pat.paint.type).toBe("pattern");
  });

  it("ambiguous input returns an error instead of a black solid", () => {
    const result = normalizePaint({ name: "Mystery" });
    expect("error" in result).toBe(true);
  });

  it("explicit type without its required sub-object returns an error", () => {
    expect("error" in normalizePaint({ type: "gradient" })).toBe(true);
  });
});

describe("get_styles", () => {
  it("returns empty lists when no styles exist", async () => {
    expect(JSON.parse(await getStyles({}))).toEqual({ fillStyles: [], effectStyles: [] });
  });

  it("serializes existing fill and effect styles", async () => {
    seedFillStyles();
    seedEffectStyles();
    const result = JSON.parse(await getStyles({}));
    expect(result.fillStyles).toEqual([
      { id: "fillstyle-brand", name: "Brand/Primary", paint: { id: "p1", type: "solid", color: "#3366ff" } },
    ]);
    expect(result.effectStyles[0]).toMatchObject({ id: "effectstyle-card", name: "Card/Shadow" });
  });
});

describe("set_styles", () => {
  it("returns an error when neither fillStyles nor effectStyles are provided", async () => {
    const result = JSON.parse(await setStyles({}));
    expect(result.error).toBeTruthy();
  });

  it("creates a fill style from the {color} shorthand", async () => {
    const result = JSON.parse(
      await setStyles({
        fillStyles: [{ name: "Brand/Primary", color: "#3366ff" }] as unknown as Record<string, unknown>,
      }),
    );
    expect(result).toMatchObject({ success: true, fillStyleCount: 1, effectStyleCount: 0 });
    const style = useStyleStore.getState().fillStyles[0];
    expect(style.name).toBe("Brand/Primary");
    expect(style.paint).toMatchObject({ type: "solid", color: "#3366ff" });
    expect(style.id).toBeTruthy();
  });

  it("infers a gradient paint type from the {gradient} shape when no explicit type is given", async () => {
    const result = JSON.parse(
      await setStyles({
        fillStyles: [
          {
            name: "Sunset",
            paint: {
              gradient: {
                type: "linear",
                stops: [
                  { color: "#ff0000", position: 0 },
                  { color: "#0000ff", position: 1 },
                ],
                startX: 0,
                startY: 0,
                endX: 1,
                endY: 1,
              },
            },
          },
        ] as unknown as Record<string, unknown>,
      }),
    );
    expect(result.success).toBe(true);
    const style = useStyleStore.getState().fillStyles[0];
    expect(style.paint.type).toBe("gradient"); // NOT silently coerced to a black solid
  });

  it("infers image/pattern paint types from their shape when no explicit type is given", async () => {
    await setStyles({
      fillStyles: [
        { name: "Photo", paint: { image: { url: "https://x/y.png", mode: "fill" } } },
        { name: "Tile", paint: { pattern: { url: "https://x/t.png" } } },
      ] as unknown as Record<string, unknown>,
    });
    const styles = useStyleStore.getState().fillStyles;
    expect(styles.find((s) => s.name === "Photo")?.paint.type).toBe("image");
    expect(styles.find((s) => s.name === "Tile")?.paint.type).toBe("pattern");
  });

  it("returns the created/updated style ids and names so the model can apply them without a get_styles round-trip", async () => {
    seedFillStyles();
    const result = JSON.parse(
      await setStyles({
        fillStyles: [
          { name: "Brand/Primary", color: "#00ff00" }, // updates the seeded style
          { name: "Accent", color: "#ff00ff" }, // creates a new one
        ] as unknown as Record<string, unknown>,
        effectStyles: [
          { name: "Card/Shadow", effects: [{ type: "blur", radius: 4 }] },
        ] as unknown as Record<string, unknown>,
      }),
    );
    expect(result.fillStyles).toEqual([
      { id: "fillstyle-brand", name: "Brand/Primary", status: "updated" },
      { id: expect.any(String), name: "Accent", status: "created" },
    ]);
    expect(result.effectStyles).toEqual([
      { id: expect.any(String), name: "Card/Shadow", status: "created" },
    ]);
    // The returned id round-trips into apply_fill_style.
    const accentId = result.fillStyles[1].id;
    expect(useStyleStore.getState().fillStyles.some((s) => s.id === accentId)).toBe(true);
  });

  it("creates an effect style from an explicit effects array", async () => {
    const result = JSON.parse(
      await setStyles({
        effectStyles: [
          {
            name: "Card/Shadow",
            effects: [
              { type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 4 }, blur: 8, spread: 0 },
            ],
          },
        ] as unknown as Record<string, unknown>,
      }),
    );
    expect(result).toMatchObject({ success: true, fillStyleCount: 0, effectStyleCount: 1 });
    const style = useStyleStore.getState().effectStyles[0];
    expect(style.effects).toHaveLength(1);
    expect(style.effects[0]).toMatchObject({ type: "shadow", blur: 8 });
  });

  it("merges by name, updating an existing fill style's color and live-propagating to referencing nodes", async () => {
    seedFillStyles();
    useStyleStore.getState().applyFillStyleToNode("rect1", "fillstyle-brand");

    const result = JSON.parse(
      await setStyles({
        fillStyles: [{ name: "Brand/Primary", color: "#00ff00" }] as unknown as Record<string, unknown>,
      }),
    );
    expect(result.fillStyleCount).toBe(1);

    const styles = useStyleStore.getState().fillStyles;
    expect(styles[0].id).toBe("fillstyle-brand");
    expect(styles[0].paint).toMatchObject({ color: "#00ff00" });
    // The node still just carries the styleId — no push-down needed.
    expect(rect1().fills![0].styleId).toBe("fillstyle-brand");
  });

  it("replaces the entire fillStyles set when replace=true, leaving effectStyles untouched", async () => {
    seedFillStyles();
    seedEffectStyles();
    const result = JSON.parse(
      await setStyles({
        fillStyles: [{ name: "Only", color: "#123456" }] as unknown as Record<string, unknown>,
        replace: true,
      }),
    );
    expect(result.fillStyleCount).toBe(1);
    expect(result.effectStyleCount).toBe(1);
    expect(useStyleStore.getState().fillStyles.map((s) => s.name)).toEqual(["Only"]);
    expect(useStyleStore.getState().effectStyles).toHaveLength(1);
  });

  it("collapses a multi-style call into a single undo step", async () => {
    const pastBefore = useHistoryStore.getState().past.length;
    await setStyles({
      fillStyles: [
        { name: "A", color: "#111111" },
        { name: "B", color: "#222222" },
      ] as unknown as Record<string, unknown>,
    });
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    expect(useStyleStore.getState().fillStyles).toHaveLength(2);
  });
});

describe("apply_fill_style", () => {
  beforeEach(() => seedFillStyles());

  it("errors when the style is not found", async () => {
    const result = JSON.parse(await applyFillStyle({ nodeIds: ["rect1"], styleId: "nope" }));
    expect(result.error).toBeTruthy();
  });

  it("binds the fill style to every given node id", async () => {
    const result = JSON.parse(
      await applyFillStyle({ nodeIds: ["rect1"], styleId: "fillstyle-brand" }),
    );
    expect(result).toEqual({ success: true, appliedCount: 1 });
    expect(rect1().fills![0].styleId).toBe("fillstyle-brand");
  });

  it("binding multiple nodes collapses into a single undo step", async () => {
    const pastBefore = useHistoryStore.getState().past.length;
    await applyFillStyle({ nodeIds: ["rect1", "rect2"], styleId: "fillstyle-brand" });
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    expect(rect1().fills![0].styleId).toBe("fillstyle-brand");
    const rect2 = useSceneStore.getState().nodesById["rect2"] as unknown as RectNode;
    expect(rect2.fills![0].styleId).toBe("fillstyle-brand");
  });
});

describe("apply_effect_style", () => {
  beforeEach(() => seedEffectStyles());

  it("errors when the style is not found", async () => {
    const result = JSON.parse(await applyEffectStyle({ nodeIds: ["rect1"], styleId: "nope" }));
    expect(result.error).toBeTruthy();
  });

  it("binds the effect style to every given node id", async () => {
    const result = JSON.parse(
      await applyEffectStyle({ nodeIds: ["rect1"], styleId: "effectstyle-card" }),
    );
    expect(result).toEqual({ success: true, appliedCount: 1 });
    expect(rect1().effectStyleId).toBe("effectstyle-card");
  });

  it("binding multiple nodes collapses into a single undo step", async () => {
    const pastBefore = useHistoryStore.getState().past.length;
    await applyEffectStyle({ nodeIds: ["rect1", "rect2"], styleId: "effectstyle-card" });
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    expect(rect1().effectStyleId).toBe("effectstyle-card");
    const rect2 = useSceneStore.getState().nodesById["rect2"] as unknown as RectNode;
    expect(rect2.effectStyleId).toBe("effectstyle-card");
  });
});
