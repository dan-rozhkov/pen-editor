import { describe, it, expect } from "vitest";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import type { FrameNode, RectNode, ShaderConfig } from "@/types/scene";

const shader: ShaderConfig = { kind: "meshGradient", preset: "Default", params: { speed: 2 } };

describe("shader field propagation", () => {
  it("instancing a reusable frame carries the shader onto the ref", () => {
    const frame: FrameNode = {
      id: "master", type: "frame", x: 0, y: 0, width: 100, height: 100,
      reusable: true, children: [], shader,
    };
    const ref = cloneNodeWithNewId(frame);
    expect(ref.type).toBe("ref");
    expect(ref.shader).toEqual(shader);
  });

  it("duplicating a plain shader node preserves the shader (spread path)", () => {
    const node: RectNode = { id: "r", type: "rect", x: 0, y: 0, width: 10, height: 10, shader };
    const copy = cloneNodeWithNewId(node);
    expect(copy.shader).toEqual(shader);
  });

  it("public pen export includes the shader field", () => {
    const node: RectNode = { id: "r", type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#fff", shader };
    const json = serializePublicPenDocument([node], [], "light");
    const doc = JSON.parse(json);
    expect(doc.children[0].shader).toEqual(shader);
  });
});
