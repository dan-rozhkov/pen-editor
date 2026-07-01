import { describe, it, expect } from "vitest";
import type { RectNode, ShaderConfig } from "@/types/scene";

describe("ShaderConfig on BaseNode", () => {
  it("attaches to a node and carries kind/preset/params", () => {
    const cfg: ShaderConfig = {
      kind: "meshGradient",
      preset: "default",
      params: { speed: 1, colors: ["#ff0000", "#0000ff"] },
    };
    const node: RectNode = {
      id: "n1", type: "rect", x: 0, y: 0, width: 100, height: 100, shader: cfg,
    };
    expect(node.shader?.kind).toBe("meshGradient");
    expect(node.shader?.params.speed).toBe(1);
  });
});
