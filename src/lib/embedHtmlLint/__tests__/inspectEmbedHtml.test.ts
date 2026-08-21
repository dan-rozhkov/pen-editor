import { describe, expect, it } from "vitest";
import { inspectEmbedHtml } from "../inspectEmbedHtml";

describe("inspectEmbedHtml", () => {
  it("reports no warnings for a valid icon", () => {
    const html = `<i class="ph ph-magnifying-glass"></i>`;
    expect(inspectEmbedHtml(html)).toEqual([]);
  });

  it("reports ph-stopwatch as unknown with a suggestion", () => {
    const html = `<i class="ph ph-stopwatch"></i>`;
    const warnings = inspectEmbedHtml(html);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Unknown Phosphor icon "ph-stopwatch"');
    expect(warnings[0]).toContain("renders as blank space");
    expect(warnings[0]).toMatch(/Did you mean "ph-(timer|watch)"\?/);
    expect(warnings[0]).toContain("@phosphor-icons/web@2.1.1");
  });

  it("never reports weight-family tokens as unknown icons", () => {
    const html = `
      <i class="ph ph-heart"></i>
      <i class="ph-fill ph-heart"></i>
      <i class="ph-bold ph-heart"></i>
      <i class="ph-duotone ph-heart"></i>
      <i class="ph-thin ph-heart"></i>
      <i class="ph-light ph-heart"></i>
    `;
    expect(inspectEmbedHtml(html)).toEqual([]);
  });

  it("handles single-quoted class attributes", () => {
    const html = `<i class='ph ph-stopwatch'></i>`;
    const warnings = inspectEmbedHtml(html);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"ph-stopwatch"');
  });

  it("dedupes repeated unknown icon names", () => {
    const html = `
      <i class="ph ph-stopwatch"></i>
      <i class="ph ph-stopwatch"></i>
      <i class="ph ph-stopwatch"></i>
    `;
    expect(inspectEmbedHtml(html)).toHaveLength(1);
  });

  it("caps warnings at 5 even with many distinct unknown names", () => {
    const html = Array.from(
      { length: 12 },
      (_, i) => `<i class="ph ph-totally-made-up-icon-${i}"></i>`,
    ).join("\n");
    expect(inspectEmbedHtml(html)).toHaveLength(5);
  });

  it("does not treat classes merely starting with 'ph' as icon classes", () => {
    const html = `<div class="phone-row"><span class="photo"></span></div>`;
    expect(inspectEmbedHtml(html)).toEqual([]);
  });

  it("reports an unknown name with no close match without a bogus suggestion", () => {
    const html = `<i class="ph ph-zzz-totally-unrecognizable-glyph-xyz"></i>`;
    const warnings = inspectEmbedHtml(html);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("Did you mean");
  });

  it("returns no warnings for empty html", () => {
    expect(inspectEmbedHtml("")).toEqual([]);
  });
});
