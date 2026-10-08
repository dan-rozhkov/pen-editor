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
});
