import { describe, it, expect } from "vitest";
import { deriveChatTitle } from "../chatTitle";

describe("deriveChatTitle", () => {
  it("returns null for an empty string", () => {
    expect(deriveChatTitle("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(deriveChatTitle("   \n\t  ")).toBeNull();
  });

  it("uses the first non-empty line of multi-line input", () => {
    expect(deriveChatTitle("\n\n  make a login screen  \nwith a password field")).toBe(
      "make a login screen",
    );
  });

  it("collapses internal whitespace", () => {
    expect(deriveChatTitle("make   a    button")).toBe("make a button");
  });

  it("strips a leading markdown heading marker", () => {
    expect(deriveChatTitle("# Redesign the header")).toBe("Redesign the header");
  });

  it("strips a leading blockquote marker", () => {
    expect(deriveChatTitle("> quoted instruction")).toBe("quoted instruction");
  });

  it("strips a leading list bullet", () => {
    expect(deriveChatTitle("- first do this")).toBe("first do this");
    expect(deriveChatTitle("* first do this")).toBe("first do this");
  });

  it("keeps a slash command as-is", () => {
    expect(deriveChatTitle("/prototype a travel booking app")).toBe(
      "/prototype a travel booking app",
    );
  });

  it("truncates long text at a word boundary with an ellipsis", () => {
    const text = "design a comprehensive onboarding flow for new mobile users";
    const title = deriveChatTitle(text);
    expect(title).toBe("design a comprehensive onboarding flow…");
    expect(title!.length).toBeLessThanOrEqual(41);
  });

  it("does not truncate text exactly at the length boundary", () => {
    const exact40 = "a".repeat(40);
    expect(exact40.length).toBe(40);
    expect(deriveChatTitle(exact40)).toBe(exact40);
  });

  it("truncates text one character past the boundary", () => {
    const text = `${"a".repeat(40)} b`;
    // No space within the first 40 chars, so it falls back to a hard cut.
    expect(deriveChatTitle(text)).toBe(`${"a".repeat(40)}…`);
  });
});
