// src/lib/designTokens/__tests__/toDtcg.test.ts
import { describe, it, expect } from "vitest";
import { toDtcg } from "@/lib/designTokens/toDtcg";
import type { DtcgGroup, DtcgToken } from "@/lib/designTokens/dtcgTypes";
import type { Variable } from "@/types/variable";
import type { FillStyle, EffectStyle } from "@/types/style";
import type { TextStyle } from "@/types/textStyle";

function tok(root: DtcgGroup, path: string[]): DtcgToken {
  let cur: unknown = root;
  for (const p of path) cur = (cur as DtcgGroup)[p];
  return cur as DtcgToken;
}

const empty = { variables: [], fillStyles: [], effectStyles: [], textStyles: [] };

describe("toDtcg", () => {
  it("maps a themed color variable with dark in $extensions", () => {
    const v: Variable = {
      id: "var_1", name: "brand/500", type: "color", value: "#3b82f6",
      themeValues: { light: "#3b82f6", dark: "#1e3a8a" },
    };
    const { document } = toDtcg({ ...empty, variables: [v] });
    const t = tok(document, ["brand", "500"]);
    expect(t.$type).toBe("color");
    expect(t.$value).toBe("#3b82f6");
    expect(t.$extensions?.["com.peneditor"]).toEqual({
      id: "var_1", source: "variable", themes: { dark: "#1e3a8a" },
    });
  });

  it("maps a number variable to $type number", () => {
    const v: Variable = { id: "var_2", name: "space/md", type: "number", value: "16" };
    const { document } = toDtcg({ ...empty, variables: [v] });
    const t = tok(document, ["space", "md"]);
    expect(t.$type).toBe("number");
    expect(t.$value).toBe(16);
  });

  it("emits string variables without $type and warns", () => {
    const v: Variable = { id: "var_3", name: "label", type: "string", value: "Hello" };
    const { document, warnings } = toDtcg({ ...empty, variables: [v] });
    const t = tok(document, ["label"]);
    expect(t.$type).toBeUndefined();
    expect(t.$value).toBe("Hello");
    expect(warnings.some((w) => w.includes("label"))).toBe(true);
  });

  it("emits a bound solid fill style as an alias", () => {
    const v: Variable = { id: "var_1", name: "brand/500", type: "color", value: "#3b82f6" };
    const fs: FillStyle = {
      id: "fillstyle_1", name: "primary",
      paint: { id: "p1", type: "solid", color: "#3b82f6", colorBinding: { variableId: "var_1" } },
    };
    const { document } = toDtcg({ ...empty, variables: [v], fillStyles: [fs] });
    const t = tok(document, ["fill", "primary"]);
    expect(t.$type).toBe("color");
    expect(t.$value).toBe("{brand.500}");
    expect(t.$extensions?.["com.peneditor"]?.source).toBe("fillStyle");
  });

  it("maps a gradient fill and a multi-shadow effect", () => {
    const grad: FillStyle = {
      id: "fillstyle_2", name: "sky",
      paint: {
        id: "p2", type: "gradient",
        gradient: {
          type: "linear",
          stops: [{ color: "#fff", position: 0 }, { color: "#000", position: 1 }],
          startX: 0, startY: 0, endX: 1, endY: 1,
        },
      },
    };
    const eff: EffectStyle = {
      id: "effectstyle_1", name: "elevated",
      effects: [
        { type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 2 }, blur: 4, spread: 0 },
        { type: "shadow", shadowType: "inner", color: "#00000020", offset: { x: 0, y: 1 }, blur: 2, spread: 0 },
      ],
    };
    const { document } = toDtcg({ ...empty, fillStyles: [grad], effectStyles: [eff] });
    const g = tok(document, ["fill", "sky"]);
    expect(g.$type).toBe("gradient");
    expect(g.$value).toEqual([{ color: "#fff", position: 0 }, { color: "#000", position: 1 }]);
    expect(g.$extensions?.["com.peneditor"]?.gradient?.type).toBe("linear");

    const s = tok(document, ["effect", "elevated"]);
    expect(s.$type).toBe("shadow");
    expect(Array.isArray(s.$value)).toBe(true);
    expect((s.$value as unknown[]).length).toBe(2);
  });

  it("skips image fills and blur effects with warnings", () => {
    const img: FillStyle = {
      id: "fillstyle_3", name: "photo",
      paint: { id: "p3", type: "image", image: { url: "data:image/png;base64,x", mode: "fill" } },
    };
    const blur: EffectStyle = {
      id: "effectstyle_2", name: "frost",
      effects: [{ type: "blur", radius: 8 }],
    };
    const { document, warnings } = toDtcg({ ...empty, fillStyles: [img], effectStyles: [blur] });
    expect((document.fill as DtcgGroup | undefined)?.photo).toBeUndefined();
    expect((document.effect as DtcgGroup | undefined)?.frost).toBeUndefined();
    expect(warnings.some((w) => w.includes("photo"))).toBe(true);
    expect(warnings.some((w) => w.includes("frost"))).toBe(true);
  });

  it("maps a text style to typography with extras in $extensions", () => {
    const ts: TextStyle = {
      id: "textstyle_1", name: "heading",
      fontFamily: "Inter", fontSize: 24, fontWeight: "700", lineHeight: 32, letterSpacing: -0.5,
      textTransform: "uppercase", fontVariations: { wght: 700 },
    };
    const { document } = toDtcg({ ...empty, textStyles: [ts] });
    const t = tok(document, ["text", "heading"]);
    expect(t.$type).toBe("typography");
    expect(t.$value).toEqual({
      fontFamily: "Inter", fontSize: 24, fontWeight: "700", lineHeight: 32, letterSpacing: -0.5,
    });
    const ext = t.$extensions?.["com.peneditor"];
    expect(ext?.textTransform).toBe("uppercase");
    expect(ext?.fontVariations).toEqual({ wght: 700 });
  });
});
