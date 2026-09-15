import { describe, it, expect } from "vitest";
import {
  forceEagerImageLoading,
  mountHtmlWithBodyStyles,
  stripForcedEagerImageLoading,
} from "../embedHtmlUtils";

/**
 * Regression coverage for the mobile-Safari lazy-image bug: WebKit never
 * issues a network request for `<img loading="lazy">` when the image is
 * outside the browser's *visual* viewport, and an embed's shadow-DOM host is
 * routinely off-screen relative to that viewport. `forceEagerImageLoading`
 * neutralises `loading="lazy"` (and sets `decoding="async"` when absent) so
 * embed content always paints regardless of intersection.
 *
 * NOTE: per the comment atop `sanitizeEmbedHtml.ts`, DOMPurify's tag
 * stripping is a no-op under happy-dom, so these tests assert only on
 * img/iframe attributes that survive `mountHtmlWithBodyStyles` — never on
 * anything DOMPurify is supposed to remove.
 */
describe("forceEagerImageLoading", () => {
  it("is a no-op on a root with no images", () => {
    const div = document.createElement("div");
    div.innerHTML = "<p>no images here</p>";
    expect(() => forceEagerImageLoading(div)).not.toThrow();
    expect(div.querySelectorAll("img").length).toBe(0);
  });

  it("converts loading=lazy to loading=eager", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" loading="lazy" />';
    forceEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("eager");
  });

  it("sets loading=eager on an img with no loading attribute", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" />';
    forceEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("eager");
  });

  it("sets decoding=async when absent", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" loading="lazy" />';
    forceEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("leaves an explicit decoding attribute alone", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" loading="lazy" decoding="sync" />';
    forceEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("decoding")).toBe("sync");
  });

  it("converts an iframe's loading=lazy to eager", () => {
    const div = document.createElement("div");
    div.innerHTML = '<iframe src="https://www.youtube.com/embed/x" loading="lazy"></iframe>';
    forceEagerImageLoading(div);
    const iframe = div.querySelector("iframe")!;
    expect(iframe.getAttribute("loading")).toBe("eager");
  });

  it("is idempotent when run twice", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" loading="lazy" />';
    forceEagerImageLoading(div);
    forceEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("decoding")).toBe("async");
  });
});

describe("mountHtmlWithBodyStyles - lazy image neutralisation", () => {
  it("forces eager loading on the plain (non-body-targeted-styles) branch", () => {
    const container = document.createElement("div");
    const html = '<div><img src="a.png" loading="lazy" /></div>';
    const result = mountHtmlWithBodyStyles(container, html, 200, 100);
    const img = result.root.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("loading")).toBe("eager");
    expect(img!.getAttribute("decoding")).toBe("async");
  });

  it("forces eager loading on the body-targeted-styles (synthetic <body>) branch", () => {
    // `hasBodyTargetedStyles` also treats a bare CSS selector targeting
    // `html`/`body` as body-targeted, without requiring a literal `<body>`
    // tag in the markup — use that form here: DOMPurify's WHOLE_DOCUMENT
    // path (triggered by an actual `<body>` tag) is unusable under
    // happy-dom (see the note atop sanitizeEmbedHtml.ts), but this test
    // still exercises the synthetic-`<body>`-creation branch of
    // `mountHtmlWithBodyStyles`.
    const container = document.createElement("div");
    const html =
      '<style>html, body { margin: 0; }</style><div><img src="a.png" loading="lazy" /></div>';
    const result = mountHtmlWithBodyStyles(container, html, 200, 100);
    expect(result.wrappedBody).toBe(true);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("loading")).toBe("eager");
    expect(img!.getAttribute("decoding")).toBe("async");
  });

  it("leaves an img with no loading attribute as eager too (plain branch)", () => {
    const container = document.createElement("div");
    const html = '<div><img src="a.png" /></div>';
    const result = mountHtmlWithBodyStyles(container, html, 200, 100);
    const img = result.root.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("loading")).toBe("eager");
  });
});

/**
 * `stripForcedEagerImageLoading` is `forceEagerImageLoading`'s inverse,
 * added for the code-review finding that `EmbedLayer.tsx`'s single-element
 * text-edit commit was reading `innerHTML` straight off the LIVE mounted
 * DOM — which this forcing pass had already mutated — so the attributes it
 * added leaked into the embed's persisted `htmlContent` on the very next
 * unrelated edit. It must undo EXACTLY what was added or overwritten, never
 * touch anything else, and never be run against the live element itself
 * (see `forceEagerImageLoading`'s own doc comment on `EmbedLayer.tsx`'s
 * commit path for why).
 */
describe("stripForcedEagerImageLoading", () => {
  it("removes a loading attribute it added where none existed before", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" />';
    forceEagerImageLoading(div);
    stripForcedEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.hasAttribute("loading")).toBe(false);
    expect(img.hasAttribute("decoding")).toBe(false);
  });

  it("restores an author-specified loading value it overwrote", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" loading="lazy" />';
    forceEagerImageLoading(div);
    expect(div.querySelector("img")!.getAttribute("loading")).toBe("eager");
    stripForcedEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("leaves an element it never touched (author already wrote loading=eager) completely alone", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" loading="eager" decoding="sync" />';
    forceEagerImageLoading(div);
    stripForcedEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("decoding")).toBe("sync");
  });

  it("leaves no marker attributes behind", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" />';
    forceEagerImageLoading(div);
    stripForcedEagerImageLoading(div);
    const img = div.querySelector("img")!;
    expect(img.outerHTML).not.toContain("data-pen-embed-eager");
    expect(img.outerHTML).not.toContain("data-pen-embed-decoding");
  });

  it("running it on a clone never affects the live element it was cloned from", () => {
    const div = document.createElement("div");
    div.innerHTML = '<img src="a.png" />';
    forceEagerImageLoading(div);

    const clone = div.cloneNode(true) as HTMLElement;
    stripForcedEagerImageLoading(clone);

    expect(clone.querySelector("img")!.getAttribute("loading")).toBeNull();
    // The live element is untouched — still eager, exactly as mounted.
    expect(div.querySelector("img")!.getAttribute("loading")).toBe("eager");
  });
});
