// src/lib/designTokens/__tests__/fromDtcg.test.ts
import { describe, it, expect } from "vitest";
import { fromDtcg } from "@/lib/designTokens/fromDtcg";
import type { DtcgDocument } from "@/lib/designTokens/dtcgTypes";
import type { SolidPaint } from "@/types/scene";

describe("fromDtcg (foreign files, no com.peneditor ext)", () => {
  it("imports a bare color token as a variable with a generated id", () => {
    const doc: DtcgDocument = { blue: { "600": { $type: "color", $value: "#2563eb" } } };
    const { result } = fromDtcg(doc);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe("blue/600");
    expect(result.variables[0].type).toBe("color");
    expect(result.variables[0].value).toBe("#2563eb");
    expect(result.variables[0].id).toMatch(/^var_/);
  });

  it("resolves an alias in a color token to a colorBinding on a fill style", () => {
    const doc: DtcgDocument = {
      blue: { "600": { $type: "color", $value: "#2563eb" } },
      fill: { action: { $type: "color", $value: "{blue.600}" } },
    };
    const { result } = fromDtcg(doc);
    expect(result.fillStyles).toHaveLength(1);
    const paint = result.fillStyles[0].paint as SolidPaint;
    expect(paint.colorBinding?.variableId).toBe(result.variables[0].id);
  });

  it("warns and skips a token whose $type has no mapping", () => {
    const doc: DtcgDocument = { weird: { $type: "cubicBezier", $value: [0, 0, 1, 1] } };
    const { result, warnings } = fromDtcg(doc);
    expect(result.variables).toHaveLength(0);
    expect(warnings.some((w) => w.includes("weird"))).toBe(true);
  });
});
