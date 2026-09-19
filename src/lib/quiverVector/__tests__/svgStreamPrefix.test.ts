import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRenderableSvgPrefix } from "../svgStreamPrefix";

/** A real 18KB QuiverAI `arrow-2` response: 132 paths, a radial gradient with
 * gradientTransform, ellipses and strokes. Captured live on 2026-09-19. */
const REAL_SAMPLE = readFileSync(join(__dirname, "quiver-sample.svg"), "utf8");

function parses(svg: string): boolean {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return doc.querySelector("parsererror") === null;
}

describe("buildRenderableSvgPrefix", () => {
  it("returns null while the root tag is still arriving", () => {
    expect(buildRenderableSvgPrefix('<svg xmlns="http://www.w3.').svg).toBeNull();
    expect(buildRenderableSvgPrefix("").svg).toBeNull();
  });

  it("drops an element truncated mid-attribute", () => {
    const partial = '<svg viewBox="0 0 10 10"><rect width="4"/><path d="m69.64 30.5';
    const { svg, completeElements } = buildRenderableSvgPrefix(partial);
    expect(completeElements).toBe(1);
    expect(svg).toBe('<svg viewBox="0 0 10 10"><rect width="4"/></svg>');
  });

  it("does not split on a '>' inside an attribute value", () => {
    const partial = '<svg viewBox="0 0 10 10"><path d="M0 0" data-note="a > b"/><path';
    expect(buildRenderableSvgPrefix(partial).completeElements).toBe(1);
  });

  it("keeps a nested element whole rather than emitting it half-open", () => {
    const head = '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/>';
    // The gradient has not closed yet: every shape referencing it would lose
    // its paint, so nothing is complete.
    expect(buildRenderableSvgPrefix(head).completeElements).toBe(0);

    const closed = `${head}</linearGradient></defs>`;
    const result = buildRenderableSvgPrefix(closed);
    expect(result.completeElements).toBe(1);
    expect(result.svg).toBe(`${closed}</svg>`);
  });

  it("skips the XML comment the model emits after the root tag", () => {
    const partial =
      '<svg viewBox="0 0 10 10">\n<!-- SVG created with Arrow, by QuiverAI -->\n<rect width="4"/><pa';
    const result = buildRenderableSvgPrefix(partial);
    expect(result.completeElements).toBe(1);
    expect(result.svg?.endsWith('<rect width="4"/></svg>')).toBe(true);
  });

  it("ignores a '<' inside a comment", () => {
    const partial = '<svg viewBox="0 0 1 1"><!-- <rect/> not real --><circle r="1"/>';
    expect(buildRenderableSvgPrefix(partial).completeElements).toBe(1);
  });

  it("does not count the document's own closing tag as a child", () => {
    const whole = '<svg viewBox="0 0 1 1"><circle r="1"/></svg>';
    expect(buildRenderableSvgPrefix(whole).completeElements).toBe(1);
  });

  it("handles a self-closing root as an empty document", () => {
    const result = buildRenderableSvgPrefix('<svg viewBox="0 0 1 1"/>');
    expect(result.completeElements).toBe(0);
    expect(parses(result.svg!)).toBe(true);
  });

  // The property that actually matters: whatever the stream stops on, what we
  // hand the renderer must never be a broken document.
  it("yields a parseable document at every prefix of a real response", () => {
    let nulls = 0;
    let checked = 0;
    for (let i = 1; i <= REAL_SAMPLE.length; i += 7) {
      const { svg } = buildRenderableSvgPrefix(REAL_SAMPLE.slice(0, i));
      if (svg === null) {
        nulls += 1;
        continue;
      }
      checked += 1;
      expect(parses(svg), `prefix length ${i} produced unparseable SVG`).toBe(true);
    }
    expect(checked).toBeGreaterThan(2000);
    // Only the very beginning, before the root tag closes, may be null.
    expect(nulls).toBeLessThan(40);
  });

  it("grows monotonically and ends at the real element count", () => {
    let previous = 0;
    for (let i = 1; i <= REAL_SAMPLE.length; i += 13) {
      const { completeElements } = buildRenderableSvgPrefix(REAL_SAMPLE.slice(0, i));
      expect(completeElements).toBeGreaterThanOrEqual(previous);
      previous = completeElements;
    }
    const total = buildRenderableSvgPrefix(REAL_SAMPLE).completeElements;
    // defs + rect + 3 circles + 4 ellipses + 132 paths, per the live census.
    expect(total).toBe(141);
    // Far fewer repaints than the ~270 deltas the stream delivers.
    expect(total).toBeLessThan(200);
  });
});
