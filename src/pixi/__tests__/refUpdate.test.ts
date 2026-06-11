import { describe, it, expect } from "vitest";
import { classifyRefChange } from "@/pixi/renderers";
import type { RefNode } from "@/types/scene";

function makeRef(overrides: Partial<RefNode> = {}): RefNode {
  return {
    id: "ref-1",
    type: "ref",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    componentId: "comp-1",
    ...overrides,
  };
}

describe("classifyRefChange", () => {
  it("returns 'none' when nothing relevant changed", () => {
    const prev = makeRef();
    // Position changes are not classified by classifyRefChange (handled elsewhere).
    const next = makeRef({ x: 10, y: 20 });
    expect(classifyRefChange(next, prev)).toBe("none");
  });

  it("returns 'structural' when componentId changes", () => {
    const prev = makeRef();
    const next = makeRef({ componentId: "comp-2" });
    expect(classifyRefChange(next, prev)).toBe("structural");
  });

  it("returns 'structural' when overrides reference changes (even with equal contents)", () => {
    const prev = makeRef({ overrides: { "a/b": { kind: "update", props: {} } } });
    // New object, structurally equal but a different reference.
    const next = makeRef({ overrides: { "a/b": { kind: "update", props: {} } } });
    expect(prev.overrides).not.toBe(next.overrides);
    expect(classifyRefChange(next, prev)).toBe("structural");
  });

  it("returns 'resize' when only width/height changed", () => {
    const prev = makeRef();
    expect(classifyRefChange(makeRef({ width: 200 }), prev)).toBe("resize");
    expect(classifyRefChange(makeRef({ height: 80 }), prev)).toBe("resize");
  });

  it("returns 'cosmetic' when only fill/stroke/binding/strokeWidth changed", () => {
    const prev = makeRef();
    expect(classifyRefChange(makeRef({ fill: "#fff" }), prev)).toBe("cosmetic");
    expect(classifyRefChange(makeRef({ stroke: "#000" }), prev)).toBe("cosmetic");
    expect(classifyRefChange(makeRef({ strokeWidth: 2 }), prev)).toBe("cosmetic");
    expect(
      classifyRefChange(makeRef({ fillBinding: { variableId: "v1" } }), prev),
    ).toBe("cosmetic");
    expect(
      classifyRefChange(makeRef({ strokeBinding: { variableId: "v2" } }), prev),
    ).toBe("cosmetic");
  });

  it("returns 'resize' when both resize and cosmetic apply", () => {
    const prev = makeRef();
    const next = makeRef({ width: 200, fill: "#fff" });
    expect(classifyRefChange(next, prev)).toBe("resize");
  });

  it("returns 'structural' (forceRebuild wins) over resize/cosmetic", () => {
    const prev = makeRef();
    const next = makeRef({ width: 200, fill: "#fff" });
    expect(classifyRefChange(next, prev, true)).toBe("structural");
  });

  it("forceRebuild wins even when nothing else changed", () => {
    const prev = makeRef();
    const next = makeRef();
    expect(classifyRefChange(next, prev, true)).toBe("structural");
  });
});
