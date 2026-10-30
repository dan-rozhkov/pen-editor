import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileTextIcon, FilmStripIcon, HashStraightIcon, PaintBrushIcon, type Icon } from "@/components/icons";

/**
 * The `.internal-link` pills in index.css draw their icon as a CSS mask built
 * from data-URI SVGs. Those are copies of the icon set's glyphs: one icon per
 * entity everywhere. Changing a glyph in the set without re-copying it here
 * fails this test. Kind names are `LinkTarget.kind` values (docLinks.ts). The shapes must match;
 * the root stroke-width may differ from the set (the mask renders at ~1em, see index.css).
 */
// Relative to this file, not process.cwd(). (happy-dom's URL cannot resolve file: bases, so no `new URL(..., import.meta.url)`.)
const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../index.css"), "utf8");

const EXPECTED: Record<string, Icon> = {
  doc: FileTextIcon,
  node: HashStraightIcon,
  canvasTab: PaintBrushIcon,
  trace: FilmStripIcon,
};

interface Tree {
  tag: string;
  attrs: Record<string, string>;
  children: Tree[];
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

function fromElement(parent: Element): Tree[] {
  return Array.from(parent.children).map((el) => ({
    tag: el.tagName.toLowerCase(),
    attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, squash(a.value)])),
    children: fromElement(el),
  }));
}

function parseSvg(markup: string): Element {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.querySelector("svg")!;
}

function maskSvg(kind: string): string {
  const match = new RegExp(`--internal-link-icon-${kind}:\\s*url\\("data:image/svg\\+xml,([^"]+)"\\)`).exec(CSS);
  if (!match) throw new Error(`index.css has no --internal-link-icon-${kind} data URI`);
  return decodeURIComponent(match[1]);
}

describe("internal link icons contract", () => {
  it("only draws an icon for the four known kinds, and no kind falls back to the doc icon", () => {
    expect(CSS).not.toMatch(/var\(--internal-link-icon,/);
    expect(CSS).not.toMatch(/\.internal-link::before/);
  });

  it("defines exactly the four chip kinds", () => {
    const kinds = [...CSS.matchAll(/--internal-link-icon-(\w+):\s*url\(/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))("%s mask equals the icon set glyph", (kind) => {
    const Glyph = EXPECTED[kind];
    const fromSet = fromElement(parseSvg(renderToStaticMarkup(<Glyph size={16} />)));
    const svg = parseSvg(maskSvg(kind));
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(fromElement(svg)).toEqual(fromSet);
    expect(Number(svg.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(1.25);
  });
});
