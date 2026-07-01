import { describe, it, expect } from "vitest";
import { makeShaderNode } from "../drawController";

describe("makeShaderNode", () => {
  it("creates a rect node carrying a default fill shader", () => {
    const n = makeShaderNode("s1", 5, 6, 200, 150);
    expect(n.type).toBe("rect");
    expect(n.x).toBe(5);
    expect(n.width).toBe(200);
    expect(n.shader?.kind).toBe("meshGradient");
    expect(n.fill).toBeUndefined();
  });
});
