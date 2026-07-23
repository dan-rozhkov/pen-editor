import { describe, it, expect } from "vitest";
import { applyPrototypeLinks } from "../applyLinks";

describe("applyPrototypeLinks", () => {
  it("sets href on anchors and wraps non-anchors", () => {
    const html = `<a data-proto-id="p0" href="#">Home</a><button data-proto-id="p1">Sign in</button>`;
    const out = applyPrototypeLinks(html, [
      { protoId: "p0", targetSlug: "home" },
      { protoId: "p1", targetSlug: "dashboard" },
    ]);
    expect(out).toContain('href="home.html"');
    expect(out).toMatch(/<a href="dashboard\.html" style="[^"]*"><button>Sign in<\/button><\/a>/);
    expect(out).not.toContain("data-proto-id");
  });

  it("wraps non-anchors in a visually-invisible, layout-neutral <a> (no underline, no box)", () => {
    const html = `<div data-proto-id="p0" class="plant-card">Monstera</div>`;
    const out = applyPrototypeLinks(html, [{ protoId: "p0", targetSlug: "detail" }]);
    // display:contents keeps the card as the grid/flex item; color/decoration
    // reset make the link indistinguishable from an unlinked element.
    expect(out).toMatch(/<a href="detail\.html" style="[^"]*display:contents[^"]*">/);
    expect(out).toContain("text-decoration:none");
    expect(out).toContain("color:inherit");
  });

  it("leaves unmatched candidates untouched (only strips proto ids)", () => {
    const html = `<a data-proto-id="p0" href="/ext">Ext</a>`;
    const out = applyPrototypeLinks(html, []);
    expect(out).toContain('href="/ext"');
    expect(out).not.toContain("data-proto-id");
  });
});
