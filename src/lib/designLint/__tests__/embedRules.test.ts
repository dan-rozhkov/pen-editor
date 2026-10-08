import { describe, expect, it } from "vitest";
import { assertDefined } from "@/test/assertions";
import { detachRegions, reconcileHtml } from "@/lib/embedComponents";
import { BTN_HTML, btnRegistry, makeRegistry } from "@/lib/embedComponents/__tests__/fixtures";
import { EMBED_CONTRAST_MAX_CHARS } from "../rules/embedRules";
import { byRule, embed, frame, lint, text, token } from "./fixtures";

const brand = token("v-brand", "--brand", "#3366ff");
const radius = token("v-r", "--radius-md", "8", { type: "number", scopes: ["radius"] });

describe("embed-literal", () => {
  it("flags inline and stylesheet color literals; equal-to-token ones carry a replace fix", () => {
    const html = `<style>.a{color:#3366ff} .b:hover{border-color:#123456}</style>
      <div class="a" style="background:#3366ff;fill:var(--x,#3366ff)">x</div>`;
    const r = lint([embed("e1", html)], { variables: [brand] });
    const found = byRule(r, "embed-literal");
    const fixes = found.flatMap((f) => (f.fix?.kind === "embed-replace" ? [f.fix] : []));
    expect(fixes.map((f) => [f.property, f.from, f.to]).sort()).toEqual([
      ["background", "#3366ff", "var(--brand)"],
      ["color", "#3366ff", "var(--brand)"],
    ]);
    const unmatched = found.filter((f) => !f.fix);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].severity).toBe("info");
    expect(unmatched[0].embedPath).toContain("style[0]");
    expect(found.every((f) => f.nodeId === "e1" && f.pageId === "p1")).toBe(true);
  });

  it("stays quiet when the document has no color tokens, and ignores var() references and custom properties", () => {
    expect(byRule(lint([embed("e1", `<div style="color:#3366ff">x</div>`)]), "embed-literal")).toHaveLength(0);
    const quiet = lint([embed("e1", `<div style="color:var(--brand);--local:#3366ff">x</div>`)], { variables: [brand] });
    expect(byRule(quiet, "embed-literal")).toHaveLength(0);
  });

  it("matches px lengths to number tokens by scope", () => {
    const r = lint([embed("e1", `<div style="border-radius:8px;padding:8px 8px">x</div>`)], { variables: [brand, radius] });
    const found = byRule(r, "embed-literal");
    expect(found).toHaveLength(1);
    expect(found[0].fix).toMatchObject({ property: "border-radius", from: "8px", to: "var(--radius-md)" });
  });

  it("skips component-managed zones in consumers and attributes master literals to the master", () => {
    const registry = makeRegistry({ btn: `<style>[data-c="btn"]{color:#3366ff}</style><button data-c="btn">Go</button>` });
    const consumer = reconcileHtml(`<button data-c="btn"></button><p style="color:#3366ff">own</p>`, registry);
    const master = registry.get("btn")!;
    const r = lint(
      [embed("master", master.html, { component: master.meta }), embed("use", consumer)],
      { variables: [brand], registry },
    );
    const found = byRule(r, "embed-literal");
    expect(found.filter((f) => f.nodeId === "master")).toHaveLength(1);
    expect(found.find((f) => f.nodeId === "master")?.message).toContain("component `btn`");
    expect(found.filter((f) => f.nodeId === "use")).toHaveLength(1);
    expect(found.find((f) => f.nodeId === "use")?.embedPath).toContain("p");
  });

  it("lints slot content, which the instance owns", () => {
    const registry = makeRegistry({ card: `<section data-c="card"><div data-c-slot="body">B</div></section>` });
    const consumer = reconcileHtml(`<section data-c="card"><div data-c-slot="body"><b style="color:#3366ff">hi</b></div></section>`, registry);
    const r = lint([embed("use", consumer)], { variables: [brand], registry });
    expect(byRule(r, "embed-literal")).toHaveLength(1);
  });
});

describe("embed contrast", () => {
  const page = (inner: string, vars = {}) => lint([embed("e1", inner)], vars);

  it("fails low contrast from inline and stylesheet declarations", () => {
    const r = page(`<style>.t{color:#777777}</style><div style="background:#ffffff"><p class="t">Hello</p></div>`);
    const [f] = byRule(r, "contrast");
    assertDefined(f);
    expect(f.severity).toBe("error");
    expect(f.embedPath).toContain("p");
    expect(f.message).toContain("4.48:1");
    expect(byRule(page(`<div style="background:#fff"><p style="color:#767676">Hello</p></div>`), "contrast")).toHaveLength(0);
  });

  it("uses inheritance for color and the nearest opaque ancestor for background", () => {
    const r = page(`<div style="background:#000;color:#222"><section><p>Hi</p></section></div>`);
    expect(byRule(r, "contrast")).toHaveLength(1);
    const translucent = page(`<div style="background:#fff"><div style="background:rgba(0,0,0,.9);color:#fff"><p>Hi</p></div></div>`);
    expect(byRule(translucent, "contrast")).toHaveLength(0);
  });

  it("applies the large-text threshold from font-size and weight", () => {
    const html = (style: string) => `<div style="background:#fff"><p style="color:#777;${style}">Hi</p></div>`;
    expect(byRule(page(html("font-size:24px")), "contrast")).toHaveLength(0);
    expect(byRule(page(html("font-size:1.5rem")), "contrast")).toHaveLength(0);
    expect(byRule(page(html("font-size:20px")), "contrast")).toHaveLength(1);
    expect(byRule(page(`<div style="background:#fff"><h3 style="color:#777;font-size:19px">Hi</h3></div>`), "contrast")).toHaveLength(0);
  });

  it("reports only fully resolved results", () => {
    for (const html of [
      `<p style="color:#777">no background anywhere</p>`,
      `<div style="background:linear-gradient(#fff,#000)"><p style="color:#777">x</p></div>`,
      `<div style="background:#fff"><p style="color:var(--unknown)">x</p></div>`,
      `<div style="background:#fff"><p style="color:#777;display:none">x</p></div>`,
      `<div style="background:#fff"><p style="color:#777" hidden>x</p></div>`,
      `<style>@media (min-width:1px){p{color:#777}}</style><div style="background:#fff"><p>x</p></div>`,
    ]) {
      expect(byRule(page(html), "contrast")).toHaveLength(0);
    }
  });

  it("resolves var() through embed custom properties, then document tokens, per mode", () => {
    const fg = token("fg", "--fg", { light: "#111111", dark: "#333333" });
    const bg = token("bg", "--bg", { light: "#ffffff", dark: "#000000" });
    const r = page(`<div style="background:var(--bg)"><p style="color:var(--fg)">Hi</p></div>`, { variables: [fg, bg] });
    const [f] = byRule(r, "contrast");
    assertDefined(f);
    expect(f.mode).toBe("Theme=Dark");
    const own = page(`<div style="--c:#777;background:#fff"><p style="color:var(--c)">Hi</p></div>`);
    expect(byRule(own, "contrast")).toHaveLength(1);
    const fallback = page(`<div style="background:#fff"><p style="color:var(--nope, #777)">Hi</p></div>`);
    expect(byRule(fallback, "contrast")).toHaveLength(1);
  });

  it("skips managed zones of consumers but checks the master itself", () => {
    const registry = makeRegistry({ tag: `<style>[data-c="tag"]{background:#fff;color:#777}</style><span data-c="tag">T</span>` });
    const master = registry.get("tag")!;
    const consumer = reconcileHtml(`<span data-c="tag"></span>`, registry);
    const r = lint([embed("master", master.html, { component: master.meta }), embed("use", consumer)], { registry });
    expect(byRule(r, "contrast").map((f) => f.nodeId)).toEqual(["master"]);
  });

  it("marks oversized embeds as partial instead of scanning them", () => {
    const big = `<p style="color:#777;background:#fff">x</p>` + " ".repeat(EMBED_CONTRAST_MAX_CHARS);
    const r = page(big);
    expect(byRule(r, "contrast")).toHaveLength(0);
    expect(r.summary.scanned.embedsPartial).toBe(1);
  });

  it("survives selectors the DOM rejects", () => {
    const r = page(`<style>p:nope(>>){color:red} p::before{color:red}</style><div style="background:#fff"><p style="color:#777">x</p></div>`);
    expect(byRule(r, "contrast")).toHaveLength(1);
  });
});

describe("deprecated-component", () => {
  it("flags regions of a deprecated master with a replacement hint and no fix", () => {
    const registry = makeRegistry({ btn: BTN_HTML }, { btn: { status: "deprecated", deprecated: { replacedBy: "button-v2", note: "old" } } });
    const html = reconcileHtml(`<button data-c="btn"></button>`, registry);
    const r = lint([embed("use", html)], { registry });
    const [f] = byRule(r, "deprecated-component");
    assertDefined(f);
    expect(f.message).toContain("button-v2");
    expect(f.fix).toBeUndefined();
    expect(byRule(lint([embed("use", html)], { registry: btnRegistry() }), "deprecated-component")).toHaveLength(0);
  });
});

describe("component-drift", () => {
  it("flags stale regions with a reconcile fix", () => {
    const html = reconcileHtml(`<button data-c="btn"></button>`, btnRegistry());
    const edited = makeRegistry({ btn: BTN_HTML.replace("padding", "margin") }, { btn: { variants: { kind: ["primary", "secondary"] } } });
    const [f] = byRule(lint([embed("use", html)], { registry: edited }), "component-drift");
    assertDefined(f);
    expect(f.fix).toEqual({ kind: "reconcile-component", key: "btn", nodeId: "use" });
    expect(byRule(lint([embed("use", html)], { registry: btnRegistry() }), "component-drift")).toHaveLength(0);
  });

  it("flags orphan regions", () => {
    const r = lint([embed("use", `<div data-c="ghost">x</div>`)], { registry: btnRegistry() });
    const [f] = byRule(r, "component-drift");
    assertDefined(f);
    expect(f.message).toContain("ghost");
    expect(f.fix).toBeUndefined();
  });

  it("reports detached copies as info", () => {
    const registry = btnRegistry();
    const html = detachRegions(reconcileHtml(`<button data-c="btn"></button>`, registry), registry, { key: "btn" }).html;
    const [f] = byRule(lint([embed("use", html)], { registry }), "component-drift");
    assertDefined(f);
    expect(f.severity).toBe("info");
    expect(f.message).toContain("`btn`");
  });

  it("reports duplicate masters on the shadowed node", () => {
    const registry = btnRegistry();
    const master = registry.get("btn")!;
    const r = lint(
      [embed("m1", master.html, { component: master.meta }), embed("m2", master.html, { component: master.meta })],
      { registry, duplicateMasters: new Map([["btn", ["m2"]]]) },
    );
    const found = byRule(r, "component-drift");
    expect(found.map((f) => f.nodeId)).toEqual(["m2"]);
    expect(found[0].message).toContain("more than one master");
  });

  it("does not flag a master's own root as stale or orphan", () => {
    const registry = btnRegistry();
    const master = registry.get("btn")!;
    const r = lint([embed("m1", master.html, { component: master.meta })], { registry });
    expect(byRule(r, "component-drift")).toHaveLength(0);
  });
});

describe("embeds and scope", () => {
  it("lints embeds of other pages only when unscoped, and never hidden ones on this page", () => {
    const other = { nodeId: "far", pageId: "p2", html: `<div style="color:#3366ff">x</div>` };
    const input = { variables: [brand], embeds: [other, { nodeId: "e1", pageId: "p1", html: `<div style="color:#3366ff">x</div>` }] };
    const all = lint([embed("e1", ""), text("t", { fill: "#000" })], input);
    expect(byRule(all, "embed-literal").map((f) => f.nodeId).sort()).toEqual(["e1", "far"]);
    const scoped = lint([embed("e1", ""), text("t", { fill: "#000" })], input, { nodeIds: ["t"] });
    expect(byRule(scoped, "embed-literal")).toHaveLength(0);
    const hidden = lint([frame("f", { visible: false, children: [embed("e1", "")] })], input);
    expect(byRule(hidden, "embed-literal").map((f) => f.nodeId)).toEqual(["far"]);
  });
});
