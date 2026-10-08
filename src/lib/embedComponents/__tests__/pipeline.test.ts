import { describe, it, expect } from "vitest";
import { describeUnknownTags, finalizeEmbedHtml } from "../pipeline";
import { extractMasterDraft, replaceWithInstances, structuralSignature } from "../extract";
import { parseMaster, validateMaster } from "../master";
import { parseEmbedHtml } from "@/lib/embedHtmlDocument";
import { assertDefined, assertOk } from "@/test/assertions";
import { btnRegistry, makeRegistry } from "./fixtures";

const registry = btnRegistry();

describe("finalizeEmbedHtml", () => {
  it("passes plain HTML through untouched when no components are involved", () => {
    const result = finalizeEmbedHtml("<p>hi</p>", { registry: new Map() });
    expect(result).toEqual({ ok: true, html: "<p>hi</p>", unknownTags: [], warnings: [] });
  });

  it("expands tags and reconciles", () => {
    const result = finalizeEmbedHtml(`<c-btn kind="secondary">Go</c-btn>`, { registry });
    assertOk(result);
    expect(result.html).toContain('data-c="btn"');
    expect(result.html).toContain("data-c-style");
  });

  it("guards the text as written, so a tampered region is refused even next to a valid tag", () => {
    const stored = finalizeEmbedHtml(`<c-btn>Go</c-btn>`, { registry });
    assertOk(stored);
    const tampered = stored.html.replace("<span", "<b>x</b><span") + "<c-btn>More</c-btn>";
    const result = finalizeEmbedHtml(tampered, { registry, previousHtml: stored.html });
    expect(result).toEqual({
      ok: false,
      error: "region `btn` is component-managed; edit the master or detach it",
    });
  });

  it("does not guard a brand-new embed (no previous HTML): it is healed instead", () => {
    const result = finalizeEmbedHtml(
      `<button data-c="btn" class="hacked"><span data-c-slot="label">Mine</span></button>`,
      { registry },
    );
    assertOk(result);
    expect(result.html).not.toContain("hacked");
    expect(result.html).toContain(">Mine<");
  });

  it("validates a master and returns it normalized", () => {
    const result = finalizeEmbedHtml(`<style>.a{b:c}</style><div data-c="box"></div>`, {
      registry,
      masterMeta: { key: "box", name: "Box" },
    });
    assertOk(result);
    expect(result.html).toContain('[data-c="box"].a');
  });

  it("rejects an invalid master and a master that would close a cycle", () => {
    expect(
      finalizeEmbedHtml("<a></a><b></b>", { registry, masterMeta: { key: "box", name: "Box" } }).ok,
    ).toBe(false);
    const reg = makeRegistry({ a: `<div data-c="a"></div>`, b: `<div data-c="b"><i data-c="a"></i></div>` });
    const cyc = finalizeEmbedHtml(`<div data-c="a"><i data-c="b"></i></div>`, {
      registry: reg,
      masterMeta: { key: "a", name: "A" },
    });
    expect(cyc.ok).toBe(false);
  });
});

describe("describeUnknownTags", () => {
  it("is null for none and names every tag otherwise", () => {
    expect(describeUnknownTags([])).toBeNull();
    expect(describeUnknownTags(["a", "b"])).toMatch(/<c-a>, <c-b>.*define_component/);
  });
});

describe("structuralSignature", () => {
  const sig = (html: string) => {
    const el = parseEmbedHtml(html)!.body.firstElementChild as Element;
    return structuralSignature(el);
  };

  it("ignores text of leaves, id and component markers", () => {
    expect(sig(`<button class="a" id="x" data-c-rev="1" data-v-k="2">One</button>`)).toBe(sig(`<button class="a">Two</button>`));
  });

  it("differs on class, structure and non-leaf text", () => {
    expect(sig(`<button class="a">x</button>`)).not.toBe(sig(`<button class="b">x</button>`));
    expect(sig(`<div><i></i>x</div>`)).not.toBe(sig(`<div><b></b>x</div>`));
    expect(sig(`<div><i></i>x</div>`)).not.toBe(sig(`<div><i></i>y</div>`));
  });
});

describe("extractMasterDraft / replaceWithInstances", () => {
  const SCREEN = `<style>.card{padding:8px}.x{color:red}</style><div class="card" id="c1"><h3>Title</h3><p>Body</p></div><div class="card"><h3>Other</h3><p>More</p></div>`;

  it("numbers text leaves as slots and keeps only the CSS that matches", () => {
    const result = extractMasterDraft(SCREEN, "#c1", "card");
    assertOk(result);
    expect(result.extraction.slots).toEqual({ text: "Title", "text-2": "Body" });
    expect(result.extraction.masterHtml).toContain('data-c-slot="text-2"');
    expect(result.extraction.masterHtml).toContain(".card");
    expect(result.extraction.masterHtml).not.toContain(".x");
    expect(result.extraction.id).toBe("c1");
  });

  it("wraps the text of a root that is itself a leaf", () => {
    const result = extractMasterDraft(`<button class="b">Hi</button>`, "button", "b");
    assertOk(result);
    expect(result.extraction.masterHtml).toContain('<span data-c-slot="text">Hi</span>');
  });

  it.each([
    ["no match", "#nope", /matched nothing/],
    ["invalid selector", "[[", /invalid selector/],
    ["document root", "body", /inside the body/],
  ])("errors on %s", (_n, selector, message) => {
    const result = extractMasterDraft(SCREEN, selector, "card");
    expect(result.ok).toBe(false);
    assertDefined((result as { error?: string }).error);
    expect((result as { error: string }).error).toMatch(message);
  });

  it("replaces the origin and every structurally equal element, keeping text and id", () => {
    const draft = extractMasterDraft(SCREEN, "#c1", "card");
    assertOk(draft);
    const validated = validateMaster(draft.extraction.masterHtml, "card");
    assertOk(validated);
    const reg = makeRegistry({ card: draft.extraction.masterHtml });
    const parsed = parseMaster(reg.get("card")!)!;

    const origin = replaceWithInstances(SCREEN, parsed, { selector: "#c1" });
    expect(origin.replaced).toBe(1);
    const all = replaceWithInstances(origin.html, parsed, {
      similarTo: draft.extraction.signature,
      tag: draft.extraction.tag,
    });
    expect(all.replaced).toBe(1);
    expect(all.html.match(/data-c="card"/g)).toHaveLength(2);
    expect(all.html).toContain('id="c1"');
    expect(all.html).toContain(">Other<");
    expect(all.html).toContain(">More<");
  });
});
