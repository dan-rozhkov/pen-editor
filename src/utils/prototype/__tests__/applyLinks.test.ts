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
    expect(out).toMatch(/<a href="dashboard\.html"><button>Sign in<\/button><\/a>/);
    expect(out).not.toContain("data-proto-id");
  });

  it("leaves unmatched candidates untouched (only strips proto ids)", () => {
    const html = `<a data-proto-id="p0" href="/ext">Ext</a>`;
    const out = applyPrototypeLinks(html, []);
    expect(out).toContain('href="/ext"');
    expect(out).not.toContain("data-proto-id");
  });
});
