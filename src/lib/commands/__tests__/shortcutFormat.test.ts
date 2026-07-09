import { describe, it, expect } from "vitest";
import { formatShortcut } from "../shortcutFormat";

describe("formatShortcut", () => {
  it("renders Mac symbols with no separator", () => {
    expect(formatShortcut(["mod", "shift", "Z"], true)).toBe("⌘⇧Z");
  });

  it("renders non-Mac labels joined with +", () => {
    expect(formatShortcut(["mod", "shift", "Z"], false)).toBe("Ctrl+Shift+Z");
  });

  it("passes through bare keys unchanged", () => {
    expect(formatShortcut(["V"], true)).toBe("V");
    expect(formatShortcut(["V"], false)).toBe("V");
  });

  it("renders alt", () => {
    expect(formatShortcut(["mod", "alt", "C"], true)).toBe("⌘⌥C");
  });
});
