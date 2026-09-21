import { describe, it, expect } from "vitest";
import { EMPTY_EMBED_HTML, isEmbedContentEmpty } from "@/lib/embedDefaults";

describe("EMPTY_EMBED_HTML", () => {
  it("is the empty string", () => {
    expect(EMPTY_EMBED_HTML).toBe("");
  });
});

describe("isEmbedContentEmpty", () => {
  it("treats undefined as empty", () => {
    expect(isEmbedContentEmpty(undefined)).toBe(true);
  });

  it("treats null as empty", () => {
    expect(isEmbedContentEmpty(null)).toBe(true);
  });

  it("treats an empty string as empty", () => {
    expect(isEmbedContentEmpty("")).toBe(true);
  });

  it("treats whitespace-only content as empty", () => {
    expect(isEmbedContentEmpty("   ")).toBe(true);
  });

  it("treats a lone newline as empty", () => {
    expect(isEmbedContentEmpty("\n")).toBe(true);
  });

  it("treats real HTML as not empty", () => {
    expect(isEmbedContentEmpty("<div>hi</div>")).toBe(false);
  });

  it("treats the legacy dummy placeholder card as not empty (real, editable content)", () => {
    const legacy =
      '<div style="padding: 16px; font-family: sans-serif; color: #333;"><h2 style="margin: 0 0 8px 0;">HTML Embed</h2><p style="margin: 0;">Edit HTML content in the properties panel.</p></div>';
    expect(isEmbedContentEmpty(legacy)).toBe(false);
  });
});
