import { describe, it, expect } from "vitest";
import { SHADER_REGISTRY, SHADER_KINDS, defaultShaderConfig } from "../registry";
import { buildShaderProps } from "../buildShaderProps";

describe("shader registry", () => {
  it("every kind has a component, >=1 preset, and non-empty params", () => {
    for (const kind of SHADER_KINDS) {
      const d = SHADER_REGISTRY[kind];
      // Library components are memo/forwardRef wrappers (objects), not plain fns.
      expect(["function", "object"]).toContain(typeof d.Component);
      expect(d.Component).toBeTruthy();
      expect(d.presets.length).toBeGreaterThan(0);
      expect(d.params.length).toBeGreaterThan(0);
      expect(["fill", "image"]).toContain(d.category);
    }
  });

  it("defaultShaderConfig resolves the first preset", () => {
    const cfg = defaultShaderConfig("waves");
    expect(cfg.kind).toBe("waves");
    expect(cfg.preset).toBe(SHADER_REGISTRY.waves.presets[0].name);
  });

  it("buildShaderProps fills defaults then applies overrides", () => {
    const props = buildShaderProps({ kind: "meshGradient", params: { speed: 2 } });
    expect(props.speed).toBe(2); // override wins
    expect(props.distortion).toBe(0.8); // default filled
  });

  it("buildShaderProps injects image only for image-filter shaders", () => {
    const img = "data:image/png;base64,AAAA";
    expect(buildShaderProps({ kind: "water", params: {} }, img).image).toBe(img);
    expect(buildShaderProps({ kind: "meshGradient", params: {} }, img).image).toBeUndefined();
  });
});
