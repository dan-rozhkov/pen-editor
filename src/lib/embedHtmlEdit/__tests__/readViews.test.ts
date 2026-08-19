import { describe, it, expect } from "vitest";
import { buildOutline, grepHtml } from "../readViews";

const SCREEN = `<html><head><style>.cta{color:#111}</style></head>
<body><div class="screen"><header class="top">Checkout page title that is quite long</header>
<main><ul><li><span>Item</span></li></ul></main></div></body></html>`;

describe("buildOutline", () => {
  it("keeps tags and attributes verbatim", () => {
    const outline = buildOutline(SCREEN, 6);
    expect(outline).toContain('<header class="top">');
    expect(outline).toContain('<div class="screen">');
  });

  it("truncates long text nodes", () => {
    const outline = buildOutline(SCREEN, 6, 10);
    expect(outline).toContain("Checkout p…");
    expect(outline).not.toContain("quite long");
  });

  it("summarizes subtrees deeper than maxDepth instead of dropping them", () => {
    const outline = buildOutline(SCREEN, 2);
    expect(outline).toMatch(/nodes omitted/);
    expect(outline).not.toContain("<span>");
  });

  it("elides style and script bodies", () => {
    const outline = buildOutline(SCREEN, 6);
    expect(outline).not.toContain("color:#111");
    expect(outline).toMatch(/<style>[\s\S]*chars omitted/);
  });

  it("warns that quoting is normalized", () => {
    expect(buildOutline(SCREEN)).toContain("grep");
  });

  it("is substantially shorter than the input for a realistic-size document", () => {
    // SCREEN itself (213 chars) is smaller than the outline's fixed ~170-char
    // explanatory header, so the compression only pays off once the document
    // is a realistic size — a real embed screen is hundreds to thousands of
    // characters, dwarfing that fixed overhead. Nest the repeats several
    // levels deep (a card list, like a real screen) so maxDepth elision
    // actually engages, rather than repeating flat siblings.
    const card =
      '<li class="card"><span class="label">Item label that is fairly long and descriptive</span>' +
      '<button class="buy" data-id="1">Buy now please</button></li>';
    const bigScreen = `<div class="screen"><section><ul class="list">${card.repeat(40)}</ul></section></div>`;
    expect(buildOutline(bigScreen).length).toBeLessThan(bigScreen.length);
  });
});

describe("grepHtml", () => {
  it("returns matching lines with context and a count", () => {
    const html = "line1\nline2 needle\nline3\nline4\nline5 needle";
    const result = grepHtml(html, "needle", 1);
    expect(result.matches).toBe(2);
    expect(result.blocks.join("\n")).toContain("2: line2 needle");
    expect(result.blocks.join("\n")).toContain("1: line1");
  });

  it("merges overlapping context windows into one block", () => {
    const html = "a needle\nb\nc needle";
    const result = grepHtml(html, "needle", 2);
    expect(result.matches).toBe(2);
    expect(result.blocks).toHaveLength(1);
  });

  it("treats the pattern literally, not as a regex", () => {
    const result = grepHtml("price: $1.00", "$1", 0);
    expect(result.matches).toBe(1);
  });

  it("returns zero matches without throwing", () => {
    const result = grepHtml("<p>hi</p>", "zzz", 2);
    expect(result.matches).toBe(0);
    expect(result.blocks).toEqual([]);
  });
});

describe("read view limits", () => {
  it("shows real structure at the default depth (html/body wrappers do not count)", () => {
    const screen =
      '<div class="screen"><main><section class="card"><h2>Title</h2></section></main></div>';
    const outline = buildOutline(screen);
    expect(outline).toContain('<section class="card">');
    expect(outline).toContain("<h2>Title</h2>");
    expect(outline).not.toMatch(/nodes omitted/);
  });

  it("caps repeated siblings instead of listing a whole list", () => {
    const items = "<li>item</li>".repeat(30);
    const outline = buildOutline(`<ul>${items}</ul>`);
    expect(outline).toContain("18 more siblings omitted");
  });

  it("escapes double quotes inside attribute values", () => {
    const outline = buildOutline('<div data-note=\'He said "hi"\'></div>');
    expect(outline).toContain('data-note="He said &quot;hi&quot;"');
  });

  it("counts every occurrence, not just matching lines", () => {
    expect(grepHtml("btn btn btn", "btn", 0).matches).toBe(3);
  });

  it("returns bounded character windows for a single-line document", () => {
    const filler = "x".repeat(1000);
    const html = `${filler}<button class="cta">Buy</button>${filler}`;
    const result = grepHtml(html, 'class="cta"', 0);
    expect(result.matches).toBe(1);
    const block = result.blocks.join("\n");
    expect(block).toContain('class="cta"');
    expect(block.length).toBeLessThan(700);
    // The window is a real substring, so it still works as an edit anchor.
    expect(html).toContain(block.slice(block.indexOf(": ") + 2));
  });

  it("caps total output and flags it as truncated", () => {
    const html = Array.from({ length: 400 }, (_, i) => `<div class="row">row ${i} ${"y".repeat(80)}</div>`).join("\n");
    const result = grepHtml(html, 'class="row"', 0);
    expect(result.matches).toBe(400);
    expect(result.truncated).toBe(true);
    expect(result.blocks.join("\n").length).toBeLessThan(20_000);
  });
});

describe("grepHtml multi-line patterns", () => {
  const html = '<div>\n  <button class="cta">\n    Buy\n  </button>\n</div>';

  it("finds an anchor that spans a line break", () => {
    const result = grepHtml(html, '<button class="cta">\n    Buy', 0);
    expect(result.matches).toBe(1);
    expect(result.blocks.join("\n")).toContain('2:   <button class="cta">');
    expect(result.blocks.join("\n")).toContain("3:     Buy");
  });

  it("counts every multi-line occurrence", () => {
    const doubled = `${html}\n${html}`;
    expect(grepHtml(doubled, '<button class="cta">\n    Buy', 0).matches).toBe(2);
  });

  it("tells the reader that line prefixes are not part of the HTML", () => {
    expect(grepHtml(html, "Buy", 0).note).toMatch(/Strip that prefix/);
  });

  it("returns nothing for an empty pattern instead of hanging", () => {
    expect(grepHtml(html, "", 0).matches).toBe(0);
  });
});
