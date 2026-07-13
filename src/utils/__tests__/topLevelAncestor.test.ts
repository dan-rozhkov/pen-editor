import { describe, it, expect } from "vitest";
import { topLevelAncestorId } from "@/utils/topLevelAncestor";

describe("topLevelAncestorId", () => {
  it("returns the id itself when it has no parent", () => {
    const parentById = { frame1: null };
    expect(topLevelAncestorId(parentById, "frame1")).toBe("frame1");
  });

  it("walks up nested parents to the root", () => {
    const parentById: Record<string, string | null> = {
      frame1: null,
      group1: "frame1",
      rect1: "group1",
    };
    expect(topLevelAncestorId(parentById, "rect1")).toBe("frame1");
  });

  it("returns the id unchanged if it isn't present in parentById", () => {
    expect(topLevelAncestorId({}, "unknown")).toBe("unknown");
  });
});
