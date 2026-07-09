import { describe, it, expect } from "vitest";
import { isAllowedIframeSrc } from "../sanitizeEmbedHtml";

/**
 * `sanitizeEmbedHtml`'s actual DOMPurify tag-stripping cannot be exercised
 * under this repo's Vitest `happy-dom` environment (see the note in
 * sanitizeEmbedHtml.ts — DOMPurify's DOM walk silently no-ops there,
 * independent of anything in this module). Instead we directly unit-test
 * `isAllowedIframeSrc`, the pure predicate the `uponSanitizeElement` hook
 * uses to decide whether a YouTube embed iframe survives sanitization.
 */
describe("isAllowedIframeSrc", () => {
  it("allows a www.youtube.com embed URL", () => {
    expect(isAllowedIframeSrc("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
  });

  it("allows a bare youtube.com embed URL", () => {
    expect(isAllowedIframeSrc("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
  });

  it("allows a youtube-nocookie.com embed URL", () => {
    expect(isAllowedIframeSrc("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(true);
  });

  it("rejects an arbitrary/non-YouTube host", () => {
    expect(isAllowedIframeSrc("https://evil.example.com/phish")).toBe(false);
  });

  it("rejects http (non-https)", () => {
    expect(isAllowedIframeSrc("http://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(false);
  });

  it("rejects a javascript: src", () => {
    expect(isAllowedIframeSrc("javascript:alert(1)")).toBe(false);
  });

  it("rejects an empty src", () => {
    expect(isAllowedIframeSrc("")).toBe(false);
  });

  it("rejects a relative src rather than resolving it against the page", () => {
    expect(isAllowedIframeSrc("/embed/dQw4w9WgXcQ")).toBe(false);
  });

  it("rejects a lookalike host (youtube.com.evil.example)", () => {
    expect(isAllowedIframeSrc("https://www.youtube.com.evil.example/embed/dQw4w9WgXcQ")).toBe(
      false,
    );
  });

  it("rejects a lookalike host (evil-youtube.com)", () => {
    expect(isAllowedIframeSrc("https://evil-youtube.com/embed/dQw4w9WgXcQ")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isAllowedIframeSrc("not a url")).toBe(false);
  });
});
