import { describe, it, expect } from "vitest";
import { filterCssRules, parseCss, scopeCss } from "../css";
import { validateMaster } from "../master";
import { finalizeEmbedHtml } from "../pipeline";
import { extractMasterDraft, replaceWithInstances, structuralSignature } from "../extract";
import { findManagedZoneViolation, reconcileHtml } from "../reconcile";
import { parseMaster } from "../master";
import { renderInstance } from "../render";
import { readRegionSpec } from "../render";
import { parseEmbedHtml } from "@/lib/embedHtmlDocument";
import { assertDefined, assertOk } from "@/test/assertions";
import { btnRegistry, makeRegistry, BTN_HTML } from "./fixtures";

const IMPORT = "@import url(https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap);";

describe("parseCss statement at-rules", () => {
  it("does not split @import url(...) on a semicolon inside parentheses", () => {
    const nodes = parseCss(`${IMPORT} .a{b:c}`);
    expect(nodes[0]).toEqual({ kind: "raw", text: IMPORT });
    expect(nodes).toHaveLength(2);
  });

  it("does not split on a semicolon inside a quoted import or a comment", () => {
    expect(parseCss(`@import "a;b.css"; /* x; y */ .a{b:c}`)[0]).toEqual({
      kind: "raw",
      text: `@import "a;b.css";`,
    });
  });
});

describe("scopeCss tag-led selectors", () => {
  it("emits root-compound and descendant forms for a tag selector", () => {
    expect(scopeCss("button { a: b }", "btn")).toBe('button[data-c="btn"], [data-c="btn"] button{a: b}');
  });

  it("puts the attribute before the first pseudo of the first compound", () => {
    expect(scopeCss("li:hover > b { a: b }", "k")).toBe('li[data-c="k"]:hover > b, [data-c="k"] li:hover > b{a: b}');
    expect(scopeCss("a.cta { a: b }", "k")).toBe('a.cta[data-c="k"], [data-c="k"] a.cta{a: b}');
  });

  it("stays idempotent for tag selectors", () => {
    const once = scopeCss("button, a.cta:hover, li > span { a: b }", "k");
    expect(scopeCss(once, "k")).toBe(once);
  });
});

describe("@import / @font-face handling", () => {
  it("filterCssRules keeps @import, @font-face and mentioned @keyframes", () => {
    const css = `${IMPORT} @font-face{font-family:X;src:url(x.woff2)} .a{animation:spin 1s} .z{c:d} @keyframes spin{to{r:1}}`;
    const out = filterCssRules(css, (s) => s === ".a");
    expect(out).toContain("@import");
    expect(out).toContain("@font-face");
    expect(out).toContain("@keyframes spin");
    expect(out).not.toContain(".z");
  });

  it("scopeCss hoists @import before every rule", () => {
    const out = scopeCss(`.a{b:c} ${IMPORT}`, "k");
    expect(out.startsWith("@import")).toBe(true);
    expect(scopeCss(out, "k")).toBe(out);
  });

  it("extraction carries @import/@font-face; the consumer's managed block starts with the import", () => {
    const screen = `<style>${IMPORT} .z{x:y} @font-face{font-family:X;src:url(x.woff2)} .cta{font-family:X}</style><main><button class="cta" id="b">Go</button></main>`;
    const draft = extractMasterDraft(screen, "#b", "cta");
    assertOk(draft);
    const validated = validateMaster(draft.extraction.masterHtml, "cta");
    assertOk(validated);
    expect(validated.master.css.startsWith("@import")).toBe(true);
    const reg = makeRegistry({ cta: draft.extraction.masterHtml });
    const html = reconcileHtml(`<main><c-cta></c-cta></main>`.replace("<c-cta></c-cta>", renderInstance(reg.get("cta")!)), reg);
    const doc = parseEmbedHtml(html)!;
    const block = doc.querySelector("style[data-c-style=cta]");
    assertDefined(block);
    expect((block.textContent ?? "").trim().startsWith("@import")).toBe(true);
    expect(block.textContent).toContain("@font-face");
  });
});

describe("master HTML with <c-key> tags", () => {
  const reg = btnRegistry();
  const CARD = `<section data-c="card"><h3 data-c-slot="title">T</h3><c-btn kind="secondary">Go</c-btn></section>`;

  it("expands nested tags through the registry before validation", () => {
    const result = finalizeEmbedHtml(CARD, { registry: reg, masterMeta: { key: "card", name: "Card" } });
    assertOk(result);
    expect(result.html).toContain('data-c="btn"');
    expect(result.html).not.toContain("<c-btn");
    expect(result.html).not.toContain("data-c-style");
  });

  it("detects a cycle written in tag syntax", () => {
    const a = makeRegistry({ a: `<div data-c="a"><span data-c-slot="s">x</span></div>` });
    const withB = makeRegistry({
      a: `<div data-c="a"><span data-c-slot="s">x</span></div>`,
      b: `<div data-c="b"><c-a></c-a></div>`,
    });
    expect(a.size).toBe(1);
    const result = finalizeEmbedHtml(`<div data-c="a"><c-b></c-b></div>`, {
      registry: withB,
      masterMeta: { key: "a", name: "A" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a master that contains its own tag", () => {
    const result = finalizeEmbedHtml(`<div data-c="card"><c-card></c-card></div>`, {
      registry: reg,
      masterMeta: { key: "card", name: "Card" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("master root inline style", () => {
  const html = `<div data-c="box" style="color:red;padding:4px"><span data-c-slot="t">x</span></div>`;
  const reg = makeRegistry({ box: html });
  const box = reg.get("box")!;

  it("stays on the rendered root instead of becoming a rule", () => {
    const result = validateMaster(html, "box");
    assertOk(result);
    expect(result.master.rootHtml).toContain('style="color:red;padding:4px"');
    expect(result.master.css).not.toContain("color:red");
    expect(renderInstance(box)).toContain('style="color:red;padding:4px"');
  });

  it("merges the instance style after the master style, so the instance wins", () => {
    const out = renderInstance(box, { attrs: { style: "color:blue" } });
    expect(out).toContain('style="color:red;padding:4px; color:blue"');
  });

  it("round-trips: reading a region yields only the instance style, and reconcile is stable", () => {
    const out = renderInstance(box, { attrs: { style: "color:blue" } });
    const region = parseEmbedHtml(out)!.body.firstElementChild as Element;
    const parsed = parseMaster(box)!;
    expect(readRegionSpec(region, parsed).attrs?.style).toBe("color:blue");
    expect(reconcileHtml(out, reg)).toBe(out);
    const plain = renderInstance(box);
    expect(readRegionSpec(parseEmbedHtml(plain)!.body.firstElementChild as Element, parsed).attrs?.style).toBeUndefined();
  });
});

describe("structuralSignature with data-*", () => {
  const sig = (html: string) => structuralSignature(parseEmbedHtml(html)!.body.firstElementChild as Element);

  it("distinguishes elements that differ in a data-* value or name", () => {
    expect(sig(`<button data-action="buy">x</button>`)).not.toBe(sig(`<button data-action="sell">x</button>`));
    expect(sig(`<button data-a="1">x</button>`)).not.toBe(sig(`<button>x</button>`));
  });

  it("ignores component markers", () => {
    expect(sig(`<button data-c-rev="1" data-v-kind="a">x</button>`)).toBe(sig(`<button>x</button>`));
  });

  it("replaceSimilar does not merge elements that differ in data-*", () => {
    const html = `<main><button class="b" id="o" data-action="buy">A</button><button class="b" data-action="sell">B</button></main>`;
    const draft = extractMasterDraft(html, "#o", "b1");
    assertOk(draft);
    const reg = makeRegistry({ b1: draft.extraction.masterHtml });
    const parsed = parseMaster(reg.get("b1")!)!;
    const out = replaceWithInstances(html, parsed, { similarTo: draft.extraction.signature, tag: "button" });
    expect(out.replaced).toBe(1);
  });
});

describe("write guard on a stale region", () => {
  it("allows a variant-only change on a stale region", () => {
    const oldReg = btnRegistry();
    const oldBtn = oldReg.get("btn")!;
    const stale = reconcileHtml(renderInstance(oldBtn, { variants: { kind: "primary" }, slots: { label: "Go" } }), oldReg);
    const newReg = makeRegistry(
      { btn: BTN_HTML.replace("<button ", '<button class="fresh" ') },
      { btn: { variants: { kind: ["primary", "secondary"] } } },
    );
    const edited = stale.replace('data-v-kind="primary" data-c-rev', 'data-v-kind="secondary" data-c-rev');
    expect(findManagedZoneViolation(stale, edited, newReg)).toBeNull();
    const tampered = stale.replace("<span", "<em>!</em><span");
    expect(findManagedZoneViolation(stale, tampered, newReg)).not.toBeNull();
  });
});
