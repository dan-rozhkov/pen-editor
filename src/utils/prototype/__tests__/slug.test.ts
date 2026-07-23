import { describe, it, expect } from "vitest";
import { assignScreenSlugs, pickStartScreenId } from "../slug";

describe("assignScreenSlugs", () => {
  it("slugifies names and dedupes collisions", () => {
    const m = assignScreenSlugs([
      { id: "a", name: "Log In" }, { id: "b", name: "log in" }, { id: "c", name: "" },
    ]);
    expect(m.get("a")).toBe("log-in");
    expect(m.get("b")).toBe("log-in-2");
    expect(m.get("c")).toBe("screen-3");
  });
});

describe("pickStartScreenId", () => {
  it("picks the top-left screen (min y then min x)", () => {
    expect(pickStartScreenId([
      { id: "a", x: 100, y: 0 }, { id: "b", x: 0, y: 0 }, { id: "c", x: 0, y: -50 },
    ])).toBe("c");
  });
});
