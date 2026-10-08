import { describe, it, expect } from "vitest";
import { expandComponentTags } from "../expand";
import { reconcileHtml } from "../reconcile";
import { findDependencyCycle } from "../cycles";
import { parseMaster } from "../master";
import { btnRegistry, cardBtnRegistry, makeRegistry } from "./fixtures";

const registry = btnRegistry();

describe("expandComponentTags", () => {
  it("returns the input untouched when there is no tag", () => {
    const html = "<div>no components</div>";
    expect(expandComponentTags(html, registry)).toEqual({ html, unknownTags: [], warnings: [] });
  });

  it("expands bare content into the first slot and a variant attribute into data-v-*", () => {
    const { html, unknownTags, warnings } = expandComponentTags(
      `<div><c-btn kind="secondary">Cancel</c-btn></div>`,
      registry,
    );
    expect(unknownTags).toEqual([]);
    expect(warnings).toEqual([]);
    expect(html).toContain('<button data-c="btn" data-v-kind="secondary"');
    expect(html).toContain('<span data-c-slot="label">Cancel</span>');
    expect(html).toContain('<style data-c-style="btn">');
    expect(html).not.toContain("<c-btn");
  });

  it("normalizes a self-closing tag and keeps the master default content", () => {
    const { html } = expandComponentTags(`<c-btn kind="primary" />`, registry);
    expect(html).toContain('data-v-kind="primary"');
    expect(html).toContain(">Save<");
  });

  it("fills named slots from <c-slot> children", () => {
    const cards = cardBtnRegistry();
    const { html } = expandComponentTags(
      `<c-card><c-slot name="title">Hello</c-slot><c-slot name="body"><p>Body</p></c-slot></c-card>`,
      cards,
    );
    expect(html).toContain('<h3 class="title" data-c-slot="title">Hello</h3>');
    expect(html).toContain('<div data-c-slot="body"><p>Body</p></div>');
  });

  it("expands nested component tags inside a slot", () => {
    const cards = cardBtnRegistry();
    const { html } = expandComponentTags(
      `<c-card><c-slot name="body"><c-btn kind="primary">Buy</c-btn></c-slot></c-card>`,
      cards,
    );
    expect(html).toContain('<button data-c="btn" data-v-kind="primary"');
    expect(html).toContain(">Buy<");
    expect(html).toContain('data-c-style="card"');
    expect(html).toContain('data-c-style="btn"');
    expect(html).not.toContain("<c-");
  });

  it("expands nested bare content of the same component type", () => {
    const boxes = makeRegistry({ box: `<div data-c="box"><div data-c-slot="in">·</div></div>` });
    const { html } = expandComponentTags(`<c-box><c-box>deep</c-box></c-box>`, boxes);
    expect(html.match(/<div data-c="box"/g)).toHaveLength(2);
    expect(html).toContain(">deep<");
  });

  it("matches only registered keys: i<c-1 inside a script is untouched", () => {
    const html = `<script>for (var i = 0; i<c-1; i++) {}</script><p>fine</p><c-btn>OK</c-btn>`;
    const out = expandComponentTags(html, registry);
    expect(out.html).toContain("<script>for (var i = 0; i<c-1; i++) {}</script>");
    expect(out.html).toContain("<p>fine</p>");
    expect(out.unknownTags).toEqual([]);
    expect(out.html).toContain('data-c="btn"');
  });

  it("does not expand tags inside script, style or comments", () => {
    const html = `<script>var x = "<c-btn>no</c-btn>";</script><!-- <c-btn>no</c-btn> --><style>/* <c-btn> */</style>`;
    const out = expandComponentTags(html, registry);
    expect(out.html).toBe(html);
  });

  it("reports unregistered <c-x> tags and leaves them as written", () => {
    const html = `<c-ghost size="1">hi</c-ghost><c-btn>OK</c-btn>`;
    const out = expandComponentTags(html, registry);
    expect(out.unknownTags).toEqual(["ghost"]);
    expect(out.html).toContain(`<c-ghost size="1">hi</c-ghost>`);
    expect(out.html).toContain('data-c="btn"');
  });

  it("warns about a non-axis attribute and keeps only style and id", () => {
    const { html, warnings } = expandComponentTags(
      `<c-btn kind="primary" class="big" style="margin:0" id="go">OK</c-btn>`,
      registry,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"class"');
    expect(html).not.toContain("big");
    expect(html).toContain('style="margin:0"');
    expect(html).toContain('id="go"');
  });

  it("warns about an unknown slot and about content for a slot-less component", () => {
    const flat = makeRegistry({ dot: `<i data-c="dot"></i>` });
    expect(expandComponentTags(`<c-dot>x</c-dot>`, flat).warnings[0]).toContain("no slots");
    expect(
      expandComponentTags(`<c-btn><c-slot name="nope">x</c-slot></c-btn>`, registry).warnings[0],
    ).toContain('no slot "nope"');
  });

  it("leaves an unclosed tag as written and says so (partial stream)", () => {
    const out = expandComponentTags(`<c-btn kind="primary">Sav`, registry);
    expect(out.html).toBe(`<c-btn kind="primary">Sav`);
    expect(out.warnings[0]).toContain("never closed");
  });

  it("ignores a cut-off opening tag", () => {
    const html = `<p>x</p><c-btn kind="pri`;
    expect(expandComponentTags(html, registry).html).toBe(html);
  });

  it("decodes entities in attribute values", () => {
    const boxes = makeRegistry({ box: `<div data-c="box"><b data-c-slot="s"></b></div>` });
    const { html } = expandComponentTags(`<c-box title="a &amp; b" style="x:y">t</c-box>`, boxes);
    expect(html).not.toContain("title=");
    expect(html).toContain('style="x:y"');
  });

  it("produces output that is stable under reconcile", () => {
    const { html } = expandComponentTags(
      `<main><c-btn kind="secondary">One</c-btn><c-btn kind="primary">Two</c-btn></main>`,
      registry,
    );
    expect(reconcileHtml(html, registry)).toBe(html);
  });

  it("leaves a <c-slot> outside any component as written", () => {
    const html = `<c-slot name="a">x</c-slot>`;
    expect(expandComponentTags(html, registry).html).toBe(html);
  });
});

describe("findDependencyCycle", () => {
  const reg = makeRegistry({
    a: `<div data-c="a"><span data-c="b"></span></div>`,
    b: `<div data-c="b"><span data-c="c"></span></div>`,
    c: `<div data-c="c"></div>`,
  });

  it("returns null for an acyclic definition", () => {
    expect(findDependencyCycle(reg, "d", ["a"])).toBeNull();
    expect(findDependencyCycle(reg, "d", [])).toBeNull();
  });

  it("finds a direct and a transitive cycle", () => {
    expect(findDependencyCycle(reg, "c", ["a"])).toEqual(["c", "a", "b", "c"]);
    expect(findDependencyCycle(reg, "a", ["a"])).toEqual(["a", "a"]);
  });

  it("ignores the registry's current definition of the key being redefined", () => {
    // Redefining "a" without b removes the a -> b edge.
    expect(findDependencyCycle(reg, "a", ["c"])).toBeNull();
    expect(parseMaster(reg.get("a")!)?.nested).toEqual(["b"]);
  });
});
