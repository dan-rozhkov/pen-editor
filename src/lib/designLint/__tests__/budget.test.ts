import { beforeEach, describe, expect, it, vi } from "vitest";
import * as embedDoc from "@/lib/embedHtmlDocument";
import { byRule, embed, lint, text } from "./fixtures";

vi.mock("@/lib/embedHtmlDocument", async (orig) => {
  const actual = await orig<typeof import("@/lib/embedHtmlDocument")>();
  return { ...actual, parseEmbedHtml: vi.fn(actual.parseEmbedHtml) };
});

/** A clock that advances one unit per call. */
const ticking = () => {
  let t = 0;
  return () => t++;
};

beforeEach(() => vi.mocked(embedDoc.parseEmbedHtml).mockClear());

describe("time budget", () => {
  it("stops parsing embeds once the budget is spent", () => {
    const roots = Array.from({ length: 10 }, (_, i) => embed(`e${i}`, `<p style="color:#777;background:#fff">x</p>`));
    const r = lint(roots, {}, { budgetMs: 3, now: ticking() });
    expect(r.truncated).toBe(true);
    expect(vi.mocked(embedDoc.parseEmbedHtml).mock.calls.length).toBeLessThan(10);
  });

  it("does not label a finding mode-specific when the budget cut the other modes off", () => {
    const roots = [text("t1", { fill: "#777777" }), text("t2", { fill: "#777777" })];
    const r = lint(roots, {}, { rules: ["contrast"], budgetMs: 2, now: ticking() });
    const found = byRule(r, "contrast");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.mode === undefined && !f.id.includes("@"))).toBe(true);
  });
});
