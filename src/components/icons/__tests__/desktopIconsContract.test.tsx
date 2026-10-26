import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as icons from "@/components/icons";
import type { Icon } from "@/components/icons";

/**
 * Cross-repo contract: the Electron shell (pen-editor-desktop) draws its tab
 * bar, Recent list, address suggestions, History and Passwords pages with
 * COPIES of this icon set's markup (src/tabbar/glyphs.ts, one JSON block per
 * weight). If a glyph changes here and the copy does not, the desktop shows a
 * different icon than the agent chat, or a different stroke. Skipped when the
 * sibling checkout is absent, unless CONTRACT_REQUIRE_DESKTOP=1 (then it fails).
 */
const DESKTOP_SRC = resolve(process.cwd(), "../pen-editor-desktop/src");
const GLYPHS_TS = join(DESKTOP_SRC, "tabbar/glyphs.ts");

const desktopExists = existsSync(GLYPHS_TS);

// Same rule as desktopMenuContract / desktopTokensContract: the cross-repo CI job must fail, not skip.
if (process.env.CONTRACT_REQUIRE_DESKTOP && !desktopExists) {
  throw new Error(`CONTRACT_REQUIRE_DESKTOP is set but ${GLYPHS_TS} does not exist`);
}

type PenNode = [string, Record<string, string>] | [string, Record<string, string>, PenNode[]];
interface Tree {
  tag: string;
  attrs: Record<string, string>;
  children: Tree[];
}

function jsonBlock(source: string, name: string): Record<string, PenNode[]> {
  const match = new RegExp(`/\\* json:${name} \\*/[^=]*=\\s*(\\{[\\s\\S]*?\\})\\s*/\\* end \\*/`).exec(source);
  if (!match) throw new Error(`glyphs.ts has no "/* json:${name} */ ... /* end */" block`);
  return JSON.parse(match[1]) as Record<string, PenNode[]>;
}

/** Mask ids are per-instance in React (useId) and fixed in the desktop: compare them as one placeholder. */
const normalise = (value: string) => value.replace(/pen-fill-mask-\w+|m_[\w]+_/g, "MASK");

function fromDesktop(nodes: PenNode[]): Tree[] {
  return nodes.map(([tag, attrs, kids]) => ({
    tag,
    attrs: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, normalise(v)])),
    children: kids ? fromDesktop(kids) : [],
  }));
}

function fromElement(parent: Element): Tree[] {
  return Array.from(parent.children).map((el) => ({
    tag: el.tagName.toLowerCase(),
    attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, normalise(a.value)])),
    children: fromElement(el),
  }));
}

function rendered(name: string, weight: "regular" | "fill"): Tree[] {
  const Glyph = (icons as Record<string, unknown>)[`${name}Icon`] as Icon | undefined;
  if (!Glyph) throw new Error(`the desktop draws "${name}", which is not in the pen icon set`);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<Glyph size={16} weight={weight} />);
  return fromElement(host.querySelector("svg")!);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|html)$/.test(entry) ? [path] : [];
  });
}

describe.runIf(desktopExists)("desktop icon contract", () => {
  const source = desktopExists ? readFileSync(GLYPHS_TS, "utf8") : "";
  const outline = desktopExists ? jsonBlock(source, "PEN_GLYPHS") : {};
  const solid = desktopExists ? jsonBlock(source, "PEN_GLYPHS_FILL") : {};

  it("copies at least one glyph", () => {
    expect(Object.keys(outline).length).toBeGreaterThan(0);
    expect(Object.keys(solid).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(outline))("%s equals the pen-editor icon (regular, 16px)", (name) => {
    expect(fromDesktop(outline[name])).toEqual(rendered(name, "regular"));
  });

  it.each(Object.keys(solid))("%s equals the pen-editor icon (fill, 16px)", (name) => {
    expect(fromDesktop(solid[name])).toEqual(rendered(name, "fill"));
  });

  it("every icon name the desktop draws is copied in glyphs.ts", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(DESKTOP_SRC)) {
      if (file === GLYPHS_TS) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/penIcon\("(\w+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/data-pen-slot="(\w+)"/g)) used.add(m[1]);
      for (const block of text.matchAll(/\bGLYPHS\b[^=\n]*=\s*(\{[^}]*\})/g)) {
        for (const m of block[1].matchAll(/"([A-Z]\w+)"/g)) used.add(m[1]);
      }
    }
    // Names also reach penIcon through tuples and helper arguments
    // (`[togglePanelEl, "SidebarSimple"]`, `icon("Globe")`). In the renderer
    // pages, any quoted string that names a pen icon counts as drawn.
    for (const dir of ["tabbar", "history", "passwords", "omnibox"]) {
      for (const file of sourceFiles(join(DESKTOP_SRC, dir))) {
        if (file === GLYPHS_TS) continue;
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(/["'`]([A-Z][A-Za-z]+)["'`]/g)) {
          // Key names ("ArrowDown" in `e.key === "ArrowDown"`, `case "ArrowUp":`) are not icons.
          const before = text.slice(Math.max(0, m.index - 24), m.index);
          if (/\bkey\b|\bcase\s*$/i.test(before)) continue;
          if (`${m[1]}Icon` in icons) used.add(m[1]);
        }
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(Object.keys(outline), `${name} is drawn but not in PEN_GLYPHS`).toContain(name);
  });

  it("the desktop has no Phosphor path data left", () => {
    for (const file of sourceFiles(DESKTOP_SRC)) {
      const text = readFileSync(file, "utf8");
      // Any 256-grid viewBox (attribute, setAttribute or svg() argument) is Phosphor-sized path data.
      expect(text, file).not.toMatch(/0 0 256 256|PHOSPHOR_/);
    }
  });
});
