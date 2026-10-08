import { describe, expect, it } from "vitest";
import { repairAndExpandPartialHtml } from "../partialComponents";
import { btnRegistry, cardBtnRegistry } from "@/lib/embedComponents/__tests__/fixtures";

describe("repairAndExpandPartialHtml", () => {
  const registry = btnRegistry();

  it("expands a complete registered tag in a partial document", () => {
    const out = repairAndExpandPartialHtml(`<div><c-btn kind="secondary">Go</c-btn><p>tail`, registry);
    expect(out).toContain('<button data-c="btn" data-v-kind="secondary"');
    expect(out).toContain(">Go<");
    expect(out).not.toContain("<c-btn");
  });

  it("drops a cut-off tag instead of expanding or showing it", () => {
    const out = repairAndExpandPartialHtml(`<div><c-btn>A</c-btn><c-btn kind="pri`, registry);
    expect(out).toContain('data-c="btn"');
    expect(out).not.toContain("<c-btn");
  });

  it("expands a tag that is still open, with the content so far", () => {
    const out = repairAndExpandPartialHtml(`<c-btn>Half`, registry);
    expect(out).toContain('data-c="btn"');
    expect(out).toContain(">Half<");
    expect(out).not.toContain("<c-btn");
  });

  it("expands completed children while the outer tag is still open", () => {
    const cards = cardBtnRegistry();
    const out = repairAndExpandPartialHtml(`<c-card><c-slot name="body"><c-btn>Buy</c-btn>`, cards);
    expect(out).not.toContain("<c-");
    expect(out).toContain('data-c="card"');
    expect(out).toContain('data-c="btn"');
  });

  it("injects each component's CSS once and gives the same text for a growing stream", () => {
    const text = `<c-btn>A</c-btn><c-btn>B</c-btn><c-btn>C`;
    const first = repairAndExpandPartialHtml(text, registry);
    expect(first.match(/data-c-style="btn"/g)).toHaveLength(1);
    expect(repairAndExpandPartialHtml(text, registry)).toBe(first);
    const grown = repairAndExpandPartialHtml(text + "D</c-btn><c-btn>E", registry);
    expect(grown.match(/data-c-style="btn"/g)).toHaveLength(1);
    expect(grown).toContain(">CD<");
  });

  it("leaves unregistered tags as written", () => {
    expect(repairAndExpandPartialHtml(`<c-zzz>x</c-zzz>`, registry)).toBe(`<c-zzz>x</c-zzz>`);
  });

  it("is a plain repair with an empty registry", () => {
    expect(repairAndExpandPartialHtml(`<div>a<c-btn kind="p`, new Map())).toBe("<div>a");
  });
});
