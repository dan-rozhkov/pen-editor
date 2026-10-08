import { describe, it, expect } from "vitest";
import { sanitizeDesignSystemScopes } from "../savedScopes";

describe("sanitizeDesignSystemScopes", () => {
  it("round-trips a valid scope", () => {
    const scope = {
      id: "s1",
      name: "Brand",
      description: "d",
      collections: ["brand"],
      modes: { brand: ["a"] },
      components: { keys: ["btn"], status: ["stable"] },
      tokenScopes: ["fill"],
      names: ["--x*"],
    };
    expect(sanitizeDesignSystemScopes([scope])).toEqual([scope]);
  });

  it.each([
    ["not an array", { id: "s" }],
    ["null", null],
    ["a string", "scopes"],
  ])("returns [] for %s", (_n, raw) => {
    expect(sanitizeDesignSystemScopes(raw)).toEqual([]);
  });

  it("drops entries without an id or a name, and repeated ids", () => {
    const out = sanitizeDesignSystemScopes([
      { id: "a", name: "A" },
      { id: "a", name: "Again" },
      { id: "", name: "No id" },
      { id: "b", name: "  " },
      { name: "No id at all" },
      7,
    ]);
    expect(out).toEqual([{ id: "a", name: "A" }]);
  });

  it("keeps only valid parts of a scope", () => {
    const [scope] = sanitizeDesignSystemScopes([
      {
        id: "a",
        name: "A",
        collections: ["x", 3, ""],
        modes: { c: ["m", 1], d: [] },
        components: { keys: [], status: ["stable", "bogus"] },
        tokenScopes: ["fill", "bogus"],
        names: "not a list",
      },
    ]);
    expect(scope).toEqual({
      id: "a",
      name: "A",
      collections: ["x"],
      modes: { c: ["m"] },
      components: { status: ["stable"] },
      tokenScopes: ["fill"],
    });
  });
});
