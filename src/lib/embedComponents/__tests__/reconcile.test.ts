import { describe, it, expect } from "vitest";
import { computeRev } from "../master";
import {
  detachRegions,
  findManagedZoneViolation,
  hasStaleRegions,
  listRegionKeys,
  reconcileHtml,
} from "../reconcile";
import { renderInstance } from "../render";
import { assertDefined } from "@/test/assertions";
import { BTN_HTML, btnRegistry, cardBtnRegistry, makeRegistry } from "./fixtures";

const registry = btnRegistry();
const btn = registry.get("btn")!;
const rev = computeRev(btn);

function regionOf(slotText: string, kind = "secondary"): string {
  return renderInstance(btn, { variants: { kind }, slots: { label: slotText } });
}

describe("renderInstance", () => {
  it("clones the master root with variants, slot content and rev", () => {
    expect(regionOf("Cancel")).toBe(
      `<button data-c="btn" data-v-kind="secondary" data-c-rev="${rev}"><span data-c-slot="label">Cancel</span></button>`,
    );
  });

  it("keeps the master default for a slot the instance does not give", () => {
    expect(renderInstance(btn, {})).toContain(">Save<");
  });

  it("ignores undeclared variant axes and applies instance style/id", () => {
    const out = renderInstance(btn, { variants: { nope: "x" }, attrs: { id: "go", style: "margin:0" } });
    expect(out).not.toContain("data-v-nope");
    expect(out).toContain('id="go"');
    expect(out).toContain('style="margin:0"');
  });
});

describe("reconcileHtml", () => {
  it("returns the same string (identity) when there is nothing to reconcile", () => {
    const plain = "<div>hello</div>";
    expect(reconcileHtml(plain, registry)).toBe(plain);
  });

  it("adds the managed style block with the first instance and stamps rev", () => {
    const out = reconcileHtml(`<div><button data-c="btn" data-v-kind="secondary"><span data-c-slot="label">Hi</span></button></div>`, registry);
    expect(out).toContain('<style data-c-style="btn">');
    expect(out).toContain(`data-c-rev="${rev}"`);
    expect(out).toContain(">Hi<");
  });

  it("is idempotent", () => {
    const first = reconcileHtml(`<main>${regionOf("A")}${regionOf("B", "primary")}</main>`, registry);
    expect(reconcileHtml(first, registry)).toBe(first);
  });

  it("re-renders a region when its master changed and keeps slot content", () => {
    const stale = `<main>${regionOf("Keep me")}</main>`;
    const changed = makeRegistry({
      btn: BTN_HTML.replace("<button", '<button class="v2"'),
    }, { btn: { variants: { kind: ["primary", "secondary"] } } });
    const out = reconcileHtml(stale, changed);
    expect(out).toContain('class="v2"');
    expect(out).toContain(">Keep me<");
    expect(out).toContain('data-v-kind="secondary"');
    expect(hasStaleRegions(stale, changed)).toBe(true);
    expect(hasStaleRegions(out, changed)).toBe(false);
  });

  it("falls back to the master default for a slot the stored region lacks", () => {
    const out = reconcileHtml(`<button data-c="btn" data-v-kind="primary"></button>`, registry);
    expect(out).toContain(">Save<");
  });

  it("restores a hand-edited managed zone but keeps the slot", () => {
    const tampered = `<button data-c="btn" data-v-kind="primary" class="hacked"><span data-c-slot="label">Mine</span><b>extra</b></button>`;
    const out = reconcileHtml(tampered, registry);
    expect(out).not.toContain("hacked");
    expect(out).not.toContain("<b>");
    expect(out).toContain(">Mine<");
  });

  it("drops the managed style block with the last instance", () => {
    const withStyle = reconcileHtml(regionOf("x"), registry);
    expect(withStyle).toContain("data-c-style");
    const removedRegion = withStyle.replace(/<button[\s\S]*<\/button>/, "<p>gone</p>");
    const out = reconcileHtml(removedRegion, registry);
    expect(out).not.toContain("data-c-style");
    expect(out).toContain("<p>gone</p>");
  });

  it("leaves a region whose key has no master as static HTML (and keeps its style)", () => {
    const orphan = `<style data-c-style="ghost">[data-c="ghost"]{color:red}</style><i data-c="ghost">stay</i>`;
    expect(reconcileHtml(orphan, registry)).toBe(orphan);
  });

  it("preserves instance style and id across reconcile", () => {
    const html = reconcileHtml(
      renderInstance(btn, { attrs: { id: "cta", style: "margin-top:4px" } }),
      registry,
    );
    expect(html).toContain('id="cta"');
    expect(html).toContain('style="margin-top:4px"');
  });

  it("preserves the fragment / body-only / full-document shape", () => {
    const region = regionOf("x");
    const fragment = reconcileHtml(region, registry);
    expect(fragment.startsWith("<style data-c-style")).toBe(true);
    expect(fragment).not.toContain("<html");

    const full = reconcileHtml(`<!DOCTYPE html><html><head><title>t</title></head><body>${region}</body></html>`, registry);
    expect(full.startsWith("<!DOCTYPE html><html>")).toBe(true);
    expect(full).toContain("<title>t</title>");
    expect(full.indexOf("data-c-style")).toBeLessThan(full.indexOf("<body"));

    const bodyOnly = reconcileHtml(`<body>${region}</body>`, registry);
    expect(bodyOnly).toContain("<body>");
    expect(bodyOnly).not.toContain("<html");
  });

  it("does not treat a script that mentions data-c as a region", () => {
    const html = `<script>var s = '<i data-c="btn">';</script><p>x</p>`;
    expect(reconcileHtml(html, registry)).toBe(html);
  });

  describe("nested components", () => {
    const nested = cardBtnRegistry();
    const card = nested.get("card")!;

    it("re-renders a nested instance placed in a slot", () => {
      const inner = renderInstance(nested.get("btn")!, { slots: { label: "Buy" } });
      const outer = renderInstance(card, { slots: { title: "Shop", body: inner } });
      const out = reconcileHtml(outer, nested);
      expect(out).toContain('data-c-style="card"');
      expect(out).toContain('data-c-style="btn"');
      expect(out).toContain(">Buy<");
      expect(reconcileHtml(out, nested)).toBe(out);
    });

    it("refreshes a stale nested instance when only the inner master changed", () => {
      const inner = renderInstance(nested.get("btn")!, { slots: { label: "Buy" } });
      const stored = reconcileHtml(renderInstance(card, { slots: { body: inner } }), nested);
      const innerChanged = makeRegistry(
        { btn: BTN_HTML.replace("<button", '<button class="v2"'), card: card.html },
        { btn: { variants: { kind: ["primary", "secondary"] } } },
      );
      const out = reconcileHtml(stored, innerChanged);
      expect(out).toContain('class="v2"');
      expect(out).toContain(">Buy<");
    });

    it("stops on a cyclic registry instead of recursing forever", () => {
      const cyclic = makeRegistry({
        a: `<div data-c="a"><span data-c-slot="s">x</span></div>`,
      });
      const a = cyclic.get("a")!;
      // Force a self-containing stored master, as a corrupted document could.
      const broken = new Map(cyclic);
      broken.set("a", { ...a, html: `<div data-c="a"><div data-c="a"><span data-c-slot="s">x</span></div></div>` });
      expect(() => reconcileHtml(`<div data-c="a"></div>`, broken)).not.toThrow();
    });
  });
});

describe("hasStaleRegions / listRegionKeys", () => {
  it("detects a missing or different rev, and ignores unknown keys", () => {
    expect(hasStaleRegions(`<button data-c="btn" data-v-kind="primary">x</button>`, registry)).toBe(true);
    expect(hasStaleRegions(`<button data-c="btn" data-c-rev="old">x</button>`, registry)).toBe(true);
    expect(hasStaleRegions(`<button data-c="btn" data-c-rev="${rev}">x</button>`, registry)).toBe(false);
    expect(hasStaleRegions(`<i data-c="ghost">x</i>`, registry)).toBe(false);
  });

  it("lists distinct keys", () => {
    expect(listRegionKeys(`<a data-c="x"></a><b data-c='y'></b><i data-c="x"></i>`).sort()).toEqual(["x", "y"]);
  });
});

describe("findManagedZoneViolation", () => {
  const base = reconcileHtml(`<main>${regionOf("One")}<p>text</p></main>`, registry);

  it("allows slot edits, variant changes and unrelated edits", () => {
    expect(findManagedZoneViolation(base, base.replace(">One<", ">Two<"), registry)).toBeNull();
    expect(
      findManagedZoneViolation(base, base.replace('data-v-kind="secondary"', 'data-v-kind="primary"'), registry),
    ).toBeNull();
    expect(findManagedZoneViolation(base, base.replace("<p>text</p>", "<p>other</p>"), registry)).toBeNull();
  });

  it("allows deleting a whole region and inserting a canonical one", () => {
    expect(findManagedZoneViolation(base, "<main><p>text</p></main>", registry)).toBeNull();
    expect(findManagedZoneViolation(base, base.replace("<p>text</p>", regionOf("New")), registry)).toBeNull();
  });

  it("refuses a change to the managed zone with the spec message", () => {
    const hacked = base.replace("<span", '<em>!</em><span');
    const violation = findManagedZoneViolation(base, hacked, registry);
    assertDefined(violation);
    expect(violation.key).toBe("btn");
    expect(violation.message).toBe("region `btn` is component-managed; edit the master or detach it");
  });

  it("refuses an attribute change on the region root", () => {
    const hacked = base.replace('<button data-c="btn"', '<button class="x" data-c="btn"');
    expect(findManagedZoneViolation(base, hacked, registry)?.key).toBe("btn");
  });

  it("refuses an edit to the managed style block", () => {
    const hacked = base.replace("padding:", "margin:");
    expect(findManagedZoneViolation(base, hacked, registry)?.key).toBe("btn");
  });

  it("tolerates drift that already existed in the old text", () => {
    const drifted = base.replace("<span", '<em>!</em><span');
    expect(findManagedZoneViolation(drifted, drifted.replace(">One<", ">Two<"), registry)).toBeNull();
  });

  it("does not guard a hand-written region of an unregistered key", () => {
    expect(findManagedZoneViolation("<p/>", `<i data-c="ghost">x</i>`, registry)).toBeNull();
  });
});

describe("detachRegions", () => {
  const stored = reconcileHtml(`<main>${regionOf("A")}${regionOf("B", "primary")}</main>`, registry);

  it("removes the markers, keeps the HTML and keeps the look via a re-scoped style", () => {
    const { html, detached } = detachRegions(stored, registry, { key: "btn" });
    expect(detached).toBe(2);
    expect(html).not.toContain("data-c=");
    expect(html).not.toContain("data-c-style");
    expect(html).not.toContain("data-c-rev");
    expect(html).toContain('data-d="btn-1"');
    expect(html).toContain('<style data-d-style="btn-1">');
    expect(html).toContain('[data-d="btn-1"][data-v-kind="primary"]');
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
  });

  it("detaches one region by selector and keeps the managed style for the rest", () => {
    const { html, detached } = detachRegions(stored, registry, { selector: "button" });
    expect(detached).toBe(1);
    expect(html.match(/<button data-c="btn"/g)).toHaveLength(1);
    expect(html).toContain('data-c-style="btn"');
    expect(html).toContain('data-d="btn-1"');
  });

  it("reports zero when the selector hits nothing", () => {
    expect(detachRegions(stored, registry, { selector: ".nope" })).toEqual({ html: stored, detached: 0 });
    expect(detachRegions(stored, registry, { selector: "[[" })).toEqual({ html: stored, detached: 0 });
  });

  it("works when the master is already gone, using the managed style block", () => {
    const { html } = detachRegions(stored, new Map(), { key: "btn" });
    expect(html).toContain('<style data-d-style="btn-1">');
    expect(html).not.toContain("data-c-style");
  });
});
