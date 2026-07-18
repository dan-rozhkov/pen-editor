import { describe, it, expect } from "vitest";
import { generatePerfScene } from "../perfScene";

describe("generatePerfScene", () => {
  it("generates the requested topology deterministically", () => {
    const a = generatePerfScene(10, 20);
    const b = generatePerfScene(10, 20);
    expect(a.rootIds).toHaveLength(10);
    expect(Object.keys(a.nodesById)).toHaveLength(10 + 10 * 20);
    expect(a).toEqual(b); // deterministic
    for (const rootId of a.rootIds) {
      expect(a.parentById[rootId]).toBeNull();
      expect(a.childrenById[rootId]).toHaveLength(20);
      for (const childId of a.childrenById[rootId]) {
        expect(a.parentById[childId]).toBe(rootId);
      }
    }
  });

  it("mixes node types including text", () => {
    const s = generatePerfScene(2, 30);
    const types = new Set(Object.values(s.nodesById).map((n) => n.type));
    expect(types.has("frame")).toBe(true);
    expect(types.has("rect")).toBe(true);
    expect(types.has("ellipse")).toBe(true);
    expect(types.has("text")).toBe(true);
  });
});
