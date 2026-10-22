import { describe, expect, it } from "vitest";
import { docFilename, docMarkdownFile } from "@/lib/docs/docExport";

describe("docFilename", () => {
  it("appends .md", () => expect(docFilename("Plan")).toBe("Plan.md"));
  it("strips forbidden characters", () => expect(docFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j.md"));
  it("strips control chars and collapses spaces", () => expect(docFilename("a\u0000\n\tb")).toBe("a b.md"));
  it("falls back for empty or all-forbidden titles", () => {
    expect(docFilename("")).toBe("Untitled.md");
    expect(docFilename("  ///  ")).toBe("Untitled.md");
    expect(docFilename("...")).toBe("Untitled.md");
  });
  it("caps the length", () => expect(docFilename("x".repeat(300)).length).toBe(103));
  it("drops leading and trailing dots", () => expect(docFilename(".hidden. ")).toBe("hidden.md"));
});

describe("docMarkdownFile", () => {
  it("puts the title as H1 before the body", () => expect(docMarkdownFile("T", "body")).toBe("# T\n\nbody\n"));
  it("uses Untitled for an empty title", () => expect(docMarkdownFile("  ", "x")).toBe("# Untitled\n\nx\n"));
  it("handles an empty body", () => expect(docMarkdownFile("T", "")).toBe("# T\n"));
});
