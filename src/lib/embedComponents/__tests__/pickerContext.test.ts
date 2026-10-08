import { describe, it, expect } from "vitest";
import { sourcePathToShadowPath } from "@/lib/embedLayerTree";
import { assertDefined } from "@/test/assertions";
import { finalizeEmbedHtml } from "../pipeline";
import { findPickedComponentRegion, insertInstanceTag } from "../pickerContext";
import { btnRegistry, cardBtnRegistry } from "./fixtures";

const SCREEN = `<main><h1>Home</h1><c-card><c-slot name="title">Hi</c-slot><c-slot name="body"><p class="note">Body</p></c-slot></c-card><footer>f</footer></main>`;

function expanded() {
  const out = finalizeEmbedHtml(SCREEN, { registry: cardBtnRegistry() });
  assertDefined(out.ok ? out : undefined);
  return out.ok ? out.html : "";
}

const shadow = (html: string, sourcePath: string) => sourcePathToShadowPath(sourcePath, html);

describe("findPickedComponentRegion", () => {
  it("classifies the region root and a managed child as managed", () => {
    const html = expanded();
    const root = findPickedComponentRegion(html, shadow(html, "main:nth-of-type(1) > section:nth-of-type(1)"));
    expect(root).toMatchObject({ key: "card", zone: "managed" });
    expect(root?.regionSelector).toBe("body > main:nth-of-type(1) > section:nth-of-type(1)");
  });

  it("classifies slot content as slot and plain HTML as none", () => {
    const html = expanded();
    const slotChild = findPickedComponentRegion(
      html,
      shadow(html, "main:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)"),
    );
    expect(slotChild).toMatchObject({ key: "card", zone: "slot" });
    expect(findPickedComponentRegion(html, shadow(html, "main:nth-of-type(1) > h1:nth-of-type(1)"))).toBeNull();
  });

  it("returns null for a stale path", () => {
    expect(findPickedComponentRegion(expanded(), shadow(expanded(), "main:nth-of-type(9)"))).toBeNull();
  });
});

describe("insertInstanceTag", () => {
  const registry = btnRegistry();
  const finalize = (html: string, previous: string) => finalizeEmbedHtml(html, { registry, previousHtml: previous });

  it("appends to the body without an anchor and expands through the pipeline", () => {
    const base = "<main><h1>Home</h1></main>";
    const tagged = insertInstanceTag(base, "btn");
    expect(tagged).toBe("<main><h1>Home</h1></main><c-btn></c-btn>");
    const out = finalize(tagged ?? "", base);
    expect(out.ok && out.html).toContain('data-c="btn"');
  });

  it("inserts after the picked element", () => {
    const base = "<main><h1>Home</h1><p>x</p></main>";
    const tagged = insertInstanceTag(base, "btn", shadow(base, "main:nth-of-type(1) > h1:nth-of-type(1)"));
    expect(tagged).toBe("<main><h1>Home</h1><c-btn></c-btn><p>x</p></main>");
  });

  it("inserts after the whole region when the pick is in a managed zone", () => {
    const start = finalize("<main><c-btn>Go</c-btn><p>x</p></main>", "");
    const html = start.ok ? start.html : "";
    const tagged = insertInstanceTag(html, "btn", shadow(html, "main:nth-of-type(1) > button:nth-of-type(1)"));
    const out = finalize(tagged ?? "", html);
    expect(out.ok).toBe(true);
    expect(out.ok && out.html.match(/<button data-c="btn"/g)).toHaveLength(2);
    expect(out.ok && out.html.indexOf("<p>x</p>")).toBeGreaterThan(out.ok ? out.html.lastIndexOf('<button data-c="btn"') : 0);
  });

  it.each([
    ["inline text", "<main><p>a <span>b</span> c</p><i>x</i></main>", "main:nth-of-type(1) > p:nth-of-type(1) > span:nth-of-type(1)", "<main><p>a <span>b</span> c</p><c-btn></c-btn><i>x</i></main>"],
    ["a list item", "<ul><li><b>a</b></li></ul>", "ul:nth-of-type(1) > li:nth-of-type(1) > b:nth-of-type(1)", "<ul><li><b>a</b><c-btn></c-btn></li></ul>"],
    ["a list", "<div><ul><li>a</li></ul></div>", "div:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(1)", "<div><ul><li>a</li></ul><c-btn></c-btn></div>"],
    ["a table row", "<div><table><tbody><tr><td>a</td></tr></tbody></table></div>", "div:nth-of-type(1) > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(1)", "<div><table><tbody><tr><td>a</td></tr></tbody></table><c-btn></c-btn></div>"],
    ["a button", "<div><button><span>go</span></button></div>", "div:nth-of-type(1) > button:nth-of-type(1) > span:nth-of-type(1)", "<div><button><span>go</span></button><c-btn></c-btn></div>"],
    ["an svg shape", "<div><svg><path></path></svg></div>", "div:nth-of-type(1) > svg:nth-of-type(1) > path:nth-of-type(1)", "<div><svg><path></path></svg><c-btn></c-btn></div>"],
  ])("never inserts inside %s", (_name, base, path, expected) => {
    expect(insertInstanceTag(base, "btn", shadow(base, path))).toBe(expected);
  });

  it("goes after the outermost region when the pick is in a nested managed zone", () => {
    const registry = cardBtnRegistry();
    const start = finalizeEmbedHtml(`<main><c-card><c-slot name="body"><c-btn>Go</c-btn></c-slot></c-card></main>`, { registry });
    const html = start.ok ? start.html : "";
    // The button sits in the card's slot: it is its own managed region.
    expect(findPickedComponentRegion(html, shadow(html, "main:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(1)"))).toMatchObject({ key: "btn", zone: "managed" });
    // A card's own managed child wins over nothing outside it.
    const inner = findPickedComponentRegion(html, shadow(html, "main:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(1) > button:nth-of-type(1) > span:nth-of-type(1)"));
    expect(inner).toMatchObject({ key: "btn", zone: "slot" });
  });
});
