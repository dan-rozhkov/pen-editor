import { describe, expect, it } from "vitest";
import { repairAndExpandPartialHtml } from "../partialComponents";
import { btnRegistry } from "@/lib/embedComponents/__tests__/fixtures";

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

  it("leaves a still-open tag and unregistered tags as written", () => {
    expect(repairAndExpandPartialHtml(`<c-btn>Half`, registry)).toBe(`<c-btn>Half`);
    expect(repairAndExpandPartialHtml(`<c-zzz>x</c-zzz>`, registry)).toBe(`<c-zzz>x</c-zzz>`);
  });

  it("is a plain repair with an empty registry", () => {
    expect(repairAndExpandPartialHtml(`<div>a<c-btn kind="p`, new Map())).toBe("<div>a");
  });
});
