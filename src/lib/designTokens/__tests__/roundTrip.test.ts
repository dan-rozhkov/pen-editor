// src/lib/designTokens/__tests__/roundTrip.test.ts
import { describe, it, expect } from "vitest";
import { toDtcg, type ExportInput } from "@/lib/designTokens/toDtcg";
import { fromDtcg } from "@/lib/designTokens/fromDtcg";

const input: ExportInput = {
  variables: [
    { id: "var_1", name: "brand/500", type: "color", value: "#3b82f6",
      themeValues: { light: "#3b82f6", dark: "#1e3a8a" } },
    { id: "var_2", name: "space/md", type: "number", value: "16" },
  ],
  fillStyles: [
    { id: "fillstyle_1", name: "primary",
      paint: { id: "p1", type: "solid", color: "#3b82f6", colorBinding: { variableId: "var_1" } } },
    { id: "fillstyle_2", name: "sky",
      paint: { id: "p2", type: "gradient", gradient: {
        type: "linear", stops: [{ color: "#fff", position: 0 }, { color: "#000", position: 1 }],
        startX: 0, startY: 0, endX: 1, endY: 1 } } },
  ],
  effectStyles: [
    { id: "effectstyle_1", name: "elevated",
      effects: [{ type: "shadow", shadowType: "outer", color: "#00000040",
        offset: { x: 0, y: 2 }, blur: 4, spread: 0 }] },
  ],
  textStyles: [
    { id: "textstyle_1", name: "heading", fontFamily: "Inter", fontSize: 24,
      fontWeight: "700", lineHeight: 32, letterSpacing: -0.5, fontVariations: { wght: 700 } },
  ],
};

describe("round-trip", () => {
  it("stores -> DTCG -> stores preserves ids and supported values", () => {
    const { document } = toDtcg(input);
    const { result } = fromDtcg(document);

    expect(result.variables).toEqual(input.variables);
    // Paint id is regenerated on import; compare structurally minus paint.id.
    expect(result.fillStyles.map((s) => ({ ...s, paint: { ...s.paint, id: "X" } })))
      .toEqual(input.fillStyles.map((s) => ({ ...s, paint: { ...s.paint, id: "X" } })));
    expect(result.effectStyles).toEqual(input.effectStyles);
    expect(result.textStyles).toEqual(input.textStyles);
  });
});
