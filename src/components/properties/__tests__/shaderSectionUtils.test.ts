import { describe, it, expect } from "vitest";
import { setShaderParam, setShaderColorAt, SHADER_SUPPORTED_TYPES } from "../shaderSectionUtils";
import type { ShaderConfig } from "@/types/scene";

const base: ShaderConfig = { kind: "meshGradient", preset: "Default", params: { speed: 1 } };

describe("shaderSectionUtils", () => {
  it("setShaderParam merges without mutating the original", () => {
    const next = setShaderParam(base, "distortion", 0.5);
    expect(next.params).toEqual({ speed: 1, distortion: 0.5 });
    expect(base.params).toEqual({ speed: 1 }); // unchanged
  });

  it("setShaderParam overrides an existing key", () => {
    expect(setShaderParam(base, "speed", 2).params.speed).toBe(2);
  });

  it("setShaderColorAt replaces one swatch immutably", () => {
    const current = ["#000000", "#ffffff"];
    const next = setShaderColorAt(base, "colors", 1, "#ff0000", current);
    expect(next.params.colors).toEqual(["#000000", "#ff0000"]);
    expect(current).toEqual(["#000000", "#ffffff"]); // unchanged
  });

  it("SHADER_SUPPORTED_TYPES covers visual node types only", () => {
    expect(SHADER_SUPPORTED_TYPES.has("rect")).toBe(true);
    expect(SHADER_SUPPORTED_TYPES.has("line")).toBe(false);
  });
});
