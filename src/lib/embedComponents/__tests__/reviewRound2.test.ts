import { describe, it, expect } from "vitest";
import { scopeCss } from "../css";
import { expandMasterHtml, finalizeEmbedHtml } from "../pipeline";
import { findManagedZoneViolation, reconcileHtml } from "../reconcile";
import { readRegionSpec, renderInstance } from "../render";
import { parseMaster } from "../master";
import { parseEmbedHtml } from "@/lib/embedHtmlDocument";
import { assertDefined } from "@/test/assertions";
import type { ComponentMaster, ComponentRegistry } from "../types";
import { btnRegistry, makeRegistry } from "./fixtures";

function master(registry: ComponentRegistry, key: string): ComponentMaster {
  const found = registry.get(key);
  assertDefined(found);
  return found;
}

function firstRegion(html: string): Element {
  const region = parseEmbedHtml(html)?.body.querySelector("[data-c]");
  assertDefined(region);
  return region;
}

const styledBtn = (style: string) =>
  makeRegistry({ btn: `<button data-c="btn" style="${style}"><span data-c-slot="label">Save</span></button>` });

describe("instance style survives master root-style changes", () => {
  it("separates the instance's own style from whatever master style was applied", () => {
    const v1 = styledBtn("color:red");
    const html = renderInstance(master(v1, "btn"), { attrs: { style: "margin:1px" } });
    let current = html;
    for (const color of ["blue", "green", "black"]) {
      current = reconcileHtml(current, styledBtn(`color:${color}`));
      const region = firstRegion(current);
      expect(region.getAttribute("style")).toBe(`color:${color}; margin:1px`);
    }
  });

  it("reads the own style back from a region rendered under an older master style", () => {
    const old = renderInstance(master(styledBtn("color:red"), "btn"), { attrs: { style: "margin:1px" } });
    const newer = styledBtn("color:blue");
    const parsed = parseMaster(master(newer, "btn"));
    assertDefined(parsed);
    const region = firstRegion(old);
    expect(readRegionSpec(region, parsed).attrs?.style).toBe("margin:1px");
  });
});

describe("unknown tags inside a master", () => {
  it("expandMasterHtml and finalizeEmbedHtml report an unregistered <c-x>", () => {
    const html = `<div data-c="card"><c-x></c-x></div>`;
    expect(expandMasterHtml(html, "card", btnRegistry()).unknownTags).toEqual(["x"]);
    const out = finalizeEmbedHtml(html, {
      registry: btnRegistry(),
      masterMeta: { key: "card", name: "card" },
    });
    expect(out.ok && out.unknownTags).toEqual(["x"]);
  });
});

describe("write guard on nested regions in the managed zone", () => {
  it("refuses a variant change on a component nested inside another component's managed zone", () => {
    const btn = master(btnRegistry(), "btn");
    const inner = renderInstance(btn, { variants: { kind: "primary" } });
    const registry = makeRegistry({ card: `<section data-c="card">${inner}</section>` });
    const withBtn = new Map([...registry, ["btn", btn]]);
    const good = reconcileHtml(renderInstance(master(withBtn, "card")), withBtn);
    const tampered = good.replace('<button data-c="btn" data-v-kind="primary"', '<button data-c="btn" data-v-kind="secondary"');
    expect(tampered).not.toBe(good);
    expect(findManagedZoneViolation(good, tampered, withBtn)?.key).toBe("card");
  });
});

describe("scopeCss does not mistake a prefix inside a functional pseudo for scoping", () => {
  it.each([":not", ":is", ":has"])("scopes .a%s([data-c]) and stays idempotent", (pseudo) => {
    const sel = `.a${pseudo}([data-c="k"])`;
    const once = scopeCss(`${sel}{x:y}`, "k");
    expect(once).toBe(`[data-c="k"]${sel}, [data-c="k"] ${sel}{x:y}`);
    expect(scopeCss(once, "k")).toBe(once);
  });
});
