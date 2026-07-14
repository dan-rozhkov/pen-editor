import { describe, it, expect } from "vitest";
import { isGoogleFont } from "../fontUtils";

describe("isGoogleFont", () => {
  it("recognizes JetBrains Mono (used by converted embeds)", () => {
    expect(isGoogleFont("JetBrains Mono")).toBe(true);
  });

  it("recognizes a family given as a CSS stack with quotes", () => {
    expect(isGoogleFont('"JetBrains Mono", monospace')).toBe(true);
  });

  it("still rejects unknown families", () => {
    expect(isGoogleFont("Definitely Not A Font")).toBe(false);
  });
});
