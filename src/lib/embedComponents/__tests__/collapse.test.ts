import { describe, it, expect } from "vitest";
import { collapseComponentRegions } from "../collapse";
import { expandComponentTags } from "../expand";
import { btnRegistry, cardBtnRegistry, makeRegistry } from "./fixtures";

const styled = makeRegistry({
  pill: `<style>[data-c="pill"]{padding:2px}</style><span data-c="pill" style="color:red"><b data-c-slot="a">A</b><i data-c-slot="b">B</i></span>`,
});

const expandedFixtures: Array<[string, () => ReturnType<typeof btnRegistry>, string]> = [
  ["single instance", btnRegistry, `<div><c-btn kind="secondary">Cancel</c-btn></div>`],
  ["default content", btnRegistry, `<c-btn kind="primary" />`],
  ["many instances", btnRegistry, `<p><c-btn>One</c-btn><c-btn kind="secondary">Two</c-btn><c-btn>Three</c-btn></p>`],
  ["named slots", cardBtnRegistry, `<c-card><c-slot name="title">Hello</c-slot><c-slot name="body"><p>Body</p></c-slot></c-card>`],
  ["slot with nested instance", cardBtnRegistry, `<c-card><c-slot name="body"><c-btn kind="secondary">Buy &amp; go</c-btn></c-slot></c-card>`],
  ["instance style and id", btnRegistry, `<c-btn id="go" style="margin:4px" kind="secondary">Go</c-btn>`],
  ["data-c-ms master style", () => styled, `<c-pill style="margin:1px"><c-slot name="b">x</c-slot></c-pill>`],
  ["empty slot", cardBtnRegistry, `<c-card><c-slot name="title"></c-slot></c-card>`],
  ["quote in attribute", btnRegistry, `<c-btn style="font-family: 'A', serif">Q</c-btn>`],
];

describe("collapseComponentRegions", () => {
  for (const [name, reg, source] of expandedFixtures) {
    it(`round-trips: ${name}`, () => {
      const registry = reg();
      const h = expandComponentTags(source, registry).html;
      const compact = collapseComponentRegions(h, registry);
      expect(expandComponentTags(compact, registry).html).toBe(h);
    });
  }

  it("writes short tags with bare content for the first slot", () => {
    const registry = btnRegistry();
    const h = expandComponentTags(`<c-btn kind="secondary">Cancel</c-btn>`, registry).html;
    const compact = collapseComponentRegions(h, registry);
    expect(compact).toContain(`<c-btn kind="secondary">Cancel</c-btn>`);
    expect(compact).not.toContain("data-c-style");
    expect(compact).not.toContain("data-c=");
  });

  it("omits default variants and uses <c-slot> for named slots", () => {
    const registry = cardBtnRegistry();
    const h = expandComponentTags(
      `<c-card><c-slot name="title">T</c-slot><c-slot name="body"><c-btn>Buy</c-btn></c-slot></c-card>`,
      registry,
    ).html;
    const compact = collapseComponentRegions(h, registry);
    expect(compact).toContain(`<c-slot name="title">T</c-slot>`);
    expect(compact).toContain(`<c-btn>Buy</c-btn>`);
    expect(compact).not.toContain("data-v-kind");
  });

  it("keeps a hand-edited managed zone expanded", () => {
    const registry = btnRegistry();
    const h = expandComponentTags(`<c-btn>Ok</c-btn>`, registry).html.replace("<button ", '<button title="x" ');
    expect(collapseComponentRegions(h, registry)).toBe(h);
  });

  it("returns plain HTML and unknown keys untouched", () => {
    const registry = btnRegistry();
    const plain = `<div class="x">hi</div>`;
    expect(collapseComponentRegions(plain, registry)).toBe(plain);
    const orphan = `<div data-c="gone"><span data-c-slot="a">x</span></div>`;
    expect(collapseComponentRegions(orphan, registry)).toBe(orphan);
  });

  it("collapses only the canonical region when two sit side by side", () => {
    const registry = btnRegistry();
    const h = expandComponentTags(`<c-btn>A</c-btn><c-btn>B</c-btn>`, registry).html;
    const edited = h.replace("<button ", '<button title="x" ');
    const compact = collapseComponentRegions(edited, registry);
    expect(compact).toContain("<c-btn>B</c-btn>");
    expect(compact).toContain('title="x"');
  });
});
