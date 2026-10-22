import { describe, expect, it } from "vitest";
import { stripLeadingTitle } from "../stripLeadingTitle";

describe("stripLeadingTitle", () => {
  it("removes a leading H1 and the blank lines after it", () => {
    expect(stripLeadingTitle("# Bug report\n\n\n## Summary\ntext\n")).toEqual({ markdown: "## Summary\ntext\n", title: "Bug report" });
  });
  it("skips leading blank lines and a closing hash sequence", () => {
    expect(stripLeadingTitle("\n\n# Plan #\nbody")).toEqual({ markdown: "body", title: "Plan" });
  });
  it("keeps a document that starts with H2, text or no H1", () => {
    for (const md of ["## Sub\ntext", "text\n# Later", "#NoSpace\nx", "", "   \n"]) {
      expect(stripLeadingTitle(md)).toEqual({ markdown: md });
    }
  });
  it("keeps later H1 headings", () => {
    expect(stripLeadingTitle("# T\n\nx\n\n# Other\n")).toEqual({ markdown: "x\n\n# Other\n", title: "T" });
  });
  it("handles a title-only document", () => {
    expect(stripLeadingTitle("# Only")).toEqual({ markdown: "", title: "Only" });
  });
  it("with a title, strips only a matching H1", () => {
    expect(stripLeadingTitle("# Bug report\n\nbody", "Bug report")).toEqual({ markdown: "body", title: "Bug report" });
    expect(stripLeadingTitle("# Plan\nbody", "Plan: Q4 roadmap")).toEqual({ markdown: "body", title: "Plan" });
  });
  it("ignores [Area] tags and punctuation when matching", () => {
    expect(
      stripLeadingTitle("# Bug report: [Checkout] Total ignores discount\n\nbody", "Bug report: Total ignores discount"),
    ).toEqual({ markdown: "body", title: "Bug report: [Checkout] Total ignores discount" });
    expect(stripLeadingTitle("# Setup - Part (1)\nx", "setup part 1")).toEqual({ markdown: "x", title: "Setup - Part (1)" });
  });
  it("keeps an H1 that is real content when it differs from the title", () => {
    const md = "# Installation\n\nsteps";
    expect(stripLeadingTitle(md, "Release notes")).toEqual({ markdown: md });
  });
  it("treats a blank title like no title", () => {
    expect(stripLeadingTitle("# Any\nx", "  ")).toEqual({ markdown: "x", title: "Any" });
  });
});
