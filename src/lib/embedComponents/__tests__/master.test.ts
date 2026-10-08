import { describe, it, expect } from "vitest";
import { computeRev, effectiveVariants, parseMaster, validateMaster } from "../master";
import { assertErr, assertOk } from "@/test/assertions";
import { BTN_HTML, btnRegistry } from "./fixtures";

describe("validateMaster", () => {
  it("accepts a well-formed master and reports slots, axes and root tag", () => {
    const result = validateMaster(BTN_HTML, "btn");
    assertOk(result);
    expect(result.master.slots).toEqual(["label"]);
    expect(result.master.axes).toEqual({ kind: "primary" });
    expect(result.master.rootTag).toBe("button");
    expect(result.master.html).toContain("<style>");
    expect(result.master.html).toContain('<button data-c="btn"');
  });

  it("prefixes bare selectors in the style block", () => {
    const result = validateMaster(
      `<style>.label { color: red }</style><div data-c="chip"><span class="label">x</span></div>`,
      "chip",
    );
    assertOk(result);
    expect(result.master.css).toContain('[data-c="chip"] .label');
  });

  it("sets data-c on a root that lacks it and rejects a different key", () => {
    const missing = validateMaster(`<div><span data-c-slot="a">x</span></div>`, "box");
    assertOk(missing);
    expect(missing.master.rootHtml).toContain('data-c="box"');

    const wrong = validateMaster(`<div data-c="other"></div>`, "box");
    assertErr(wrong);
  });

  it.each([
    ["two roots", `<div data-c="box"></div><div></div>`],
    ["text next to the root", `hello <div data-c="box"></div>`],
    ["no root", `<style>a{b:c}</style>`],
  ])("rejects %s", (_name, html) => {
    const result = validateMaster(html, "box");
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate slots and invalid keys", () => {
    assertErr(validateMaster(`<div><i data-c-slot="a"></i><b data-c-slot="a"></b></div>`, "box"));
    assertErr(validateMaster(`<div></div>`, "Bad Key"));
    assertErr(validateMaster(`<div></div>`, "slot"));
  });

  it("moves the root style attribute into the stylesheet and drops id", () => {
    const result = validateMaster(`<div data-c="box" id="x" style="color:red"></div>`, "box");
    assertOk(result);
    expect(result.master.rootHtml).not.toContain("style=");
    expect(result.master.rootHtml).not.toContain("id=");
    expect(result.master.css).toContain("color:red");
  });

  it("adds meta-declared variant axes to the root", () => {
    const result = validateMaster(`<div data-c="box"></div>`, "box", { size: ["sm", "lg"] });
    assertOk(result);
    expect(result.master.axes).toEqual({ size: "sm" });
    expect(result.master.rootHtml).toContain('data-v-size="sm"');
  });

  it("collects nested component keys and refuses self-nesting", () => {
    const nested = validateMaster(`<div data-c="card"><span data-c="icon"></span></div>`, "card");
    assertOk(nested);
    expect(nested.master.nested).toEqual(["icon"]);
    assertErr(validateMaster(`<div data-c="card"><span data-c="card"></span></div>`, "card"));
  });

  it("is idempotent on its own output", () => {
    const once = validateMaster(BTN_HTML, "btn");
    assertOk(once);
    const twice = validateMaster(once.master.html, "btn");
    assertOk(twice);
    expect(twice.master.html).toBe(once.master.html);
    expect(twice.master.rev).toBe(once.master.rev);
  });
});

describe("computeRev / parseMaster", () => {
  it("changes when the master or its variants change, not when the name does", () => {
    const registry = btnRegistry();
    const master = registry.get("btn")!;
    const rev = computeRev(master);
    expect(rev).toMatch(/^[0-9a-f]{8}$/);
    expect(computeRev({ ...master, meta: { ...master.meta, name: "Renamed" } })).toBe(rev);
    expect(computeRev({ ...master, html: master.html.replace("Save", "Go") })).not.toBe(rev);
    expect(
      computeRev({ ...master, meta: { ...master.meta, variants: { kind: ["primary", "ghost"] } } }),
    ).not.toBe(rev);
  });

  it("returns null for a stored master that no longer validates", () => {
    const master = btnRegistry().get("btn")!;
    expect(parseMaster({ ...master, html: "<div></div><div></div>" })).toBeNull();
  });

  it("derives effective variants from meta plus root axes", () => {
    const master = btnRegistry().get("btn")!;
    const parsed = parseMaster(master)!;
    expect(effectiveVariants(master, parsed)).toEqual({ kind: ["primary", "secondary"] });
  });
});
