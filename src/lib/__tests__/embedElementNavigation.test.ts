import { describe, it, expect } from "vitest";
import {
  firstChildEmbedElement,
  isNavigableEmbedElement,
  navigableChildren,
  parentEmbedElement,
  siblingEmbedElement,
} from "../embedElementNavigation";

function makeRoot(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Mirrors `mountHtmlWithBodyStyles`'s UNWRAPPED branch (no body-targeted
 * styles): a shadow root whose sole child is the mount container `<div>`,
 * with the given html mounted directly into it. */
function makeShadowRoot(html: string): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.innerHTML = html;
  shadow.appendChild(container);
  return shadow;
}

/** Mirrors `mountHtmlWithBodyStyles`'s WRAPPED branch (body-targeted
 * styles present): container `<div>` holding a synthetic `<body>`, with the
 * given html mounted into that body. */
function makeShadowRootWithBody(html: string): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  const body = document.createElement("body");
  body.innerHTML = html;
  container.appendChild(body);
  shadow.appendChild(container);
  return shadow;
}

describe("isNavigableEmbedElement / navigableChildren", () => {
  it("excludes skipped tags (script/style) and inline display:none", () => {
    const root = makeRoot(`
      <div>
        <p>visible</p>
        <script>1</script>
        <style>.x{}</style>
        <span style="display: none">hidden</span>
      </div>
    `);
    const wrapper = root.querySelector("div")!;
    const kids = navigableChildren(wrapper);
    expect(kids.map((k) => k.tagName.toLowerCase())).toEqual(["p"]);

    expect(isNavigableEmbedElement(root.querySelector("script")!)).toBe(false);
    expect(isNavigableEmbedElement(root.querySelector("style")!)).toBe(false);
    expect(isNavigableEmbedElement(root.querySelector("span")!)).toBe(false);
    expect(isNavigableEmbedElement(root.querySelector("p")!)).toBe(true);
  });
});

describe("siblingEmbedElement", () => {
  it("wraps around forward past the last sibling", () => {
    const root = makeRoot(`<div><p>a</p><p>b</p><p>c</p></div>`);
    const [a, b, c] = Array.from(root.querySelectorAll("p"));

    expect(siblingEmbedElement(a, root, 1)).toBe(b);
    expect(siblingEmbedElement(b, root, 1)).toBe(c);
    expect(siblingEmbedElement(c, root, 1)).toBe(a);
  });

  it("wraps around backward past the first sibling", () => {
    const root = makeRoot(`<div><p>a</p><p>b</p><p>c</p></div>`);
    const [a, b, c] = Array.from(root.querySelectorAll("p"));

    expect(siblingEmbedElement(a, root, -1)).toBe(c);
    expect(siblingEmbedElement(c, root, -1)).toBe(b);
    expect(siblingEmbedElement(b, root, -1)).toBe(a);
  });

  it("skips script/style and hidden elements when computing siblings", () => {
    const root = makeRoot(`
      <div>
        <p>a</p>
        <script>1</script>
        <span style="display: none">hidden</span>
        <p>b</p>
      </div>
    `);
    const [a, b] = Array.from(root.querySelectorAll("p"));

    expect(siblingEmbedElement(a, root, 1)).toBe(b);
    expect(siblingEmbedElement(b, root, 1)).toBe(a);
  });

  it("returns null when there is exactly one navigable sibling (nowhere to go)", () => {
    const root = makeRoot(`<div><p>only</p></div>`);
    const only = root.querySelector("p")!;

    expect(siblingEmbedElement(only, root, 1)).toBeNull();
    expect(siblingEmbedElement(only, root, -1)).toBeNull();
  });

  it("lands on the first navigable sibling (Tab) when el itself isn't navigable but siblings are", () => {
    const root = makeRoot(
      `<div><p style="display: none">A</p><p>B</p><p>C</p></div>`,
    );
    const [a, , c] = Array.from(root.querySelectorAll("p"));

    expect(siblingEmbedElement(a, root, 1)).toBe(root.querySelector("p:nth-of-type(2)"));
    // Shift+Tab from the same dead spot lands on the LAST navigable sibling.
    expect(siblingEmbedElement(a, root, -1)).toBe(c);
  });

  it("returns null when el isn't navigable and no navigable siblings exist either", () => {
    const root = makeRoot(`<div><p style="display: none">only</p></div>`);
    const hidden = root.querySelector("p[style]")!;

    expect(siblingEmbedElement(hidden, root, 1)).toBeNull();
    expect(siblingEmbedElement(hidden, root, -1)).toBeNull();
  });

  it("returns null when el sits outside root's subtree", () => {
    const root = makeRoot(`<div><p>a</p></div>`);
    const outsider = document.createElement("p");
    document.body.appendChild(outsider);

    expect(siblingEmbedElement(outsider, root, 1)).toBeNull();
  });

  it("navigates top-level siblings normally when el's parent is the shadow mount container", () => {
    const shadow = makeShadowRoot(`<header>h</header><main>m</main><footer>f</footer>`);
    const header = shadow.querySelector("header")!;
    const main = shadow.querySelector("main")!;
    const footer = shadow.querySelector("footer")!;

    expect(siblingEmbedElement(header, shadow, 1)).toBe(main);
    expect(siblingEmbedElement(main, shadow, 1)).toBe(footer);
    expect(siblingEmbedElement(footer, shadow, 1)).toBe(header);
  });

  it("navigates top-level siblings normally when el's parent is the synthetic body", () => {
    const shadow = makeShadowRootWithBody(`<header>h</header><main>m</main>`);
    const header = shadow.querySelector("header")!;
    const main = shadow.querySelector("main")!;

    expect(siblingEmbedElement(header, shadow, 1)).toBe(main);
    expect(siblingEmbedElement(main, shadow, 1)).toBe(header);
  });
});

describe("firstChildEmbedElement", () => {
  it("returns the first navigable child", () => {
    const root = makeRoot(`<div><section><p>a</p><p>b</p></section></div>`);
    const section = root.querySelector("section")!;
    const a = root.querySelector("p")!;

    expect(firstChildEmbedElement(section)).toBe(a);
  });

  it("skips a leading skipped-tag or hidden child in favor of the next navigable one", () => {
    const root = makeRoot(`
      <section>
        <style>.x{}</style>
        <span style="display: none">hidden</span>
        <p>first visible</p>
      </section>
    `);
    const section = root.querySelector("section")!;
    const p = root.querySelector("p")!;

    expect(firstChildEmbedElement(section)).toBe(p);
  });

  it("returns null for a leaf with no element children", () => {
    const root = makeRoot(`<p>just text</p>`);
    const p = root.querySelector("p")!;

    expect(firstChildEmbedElement(p)).toBeNull();
  });

  it("returns null for an element that collapses into its own text row (inline-only children + text)", () => {
    // `<span class="badge">3</span>` is a purely INLINE_TAGS child and the
    // div has real text ("Label"), so `embedLayerTree.ts`'s `buildRow`
    // collapses the whole div to one text row with `children: []` — there
    // is no row for the span anywhere in the layers panel, so Enter must
    // not be able to land on it either.
    const root = makeRoot(`<div>Label <span class="badge">3</span></div>`);
    const div = root.querySelector("div")!;

    expect(firstChildEmbedElement(div)).toBeNull();
  });

  it("returns null for an icon-wrapper element that collapses to a childless leaf row with NO text (Finding 2)", () => {
    // `<span class="ph ph-bell"></span>` is a purely INLINE_TAGS child, but
    // — unlike the "Label <span>3</span>" case above — the wrapper has no
    // text at all. `embedLayerTree.ts`'s `buildRow` still collapses it to a
    // single childless row (leaf-eligible alone is enough; it keeps kind
    // "frame" instead of becoming "text", but `children` is still `[]`). A
    // predicate that also required text content (the old
    // `collapsesToTextRow`) would miss this and let Enter descend into the
    // `<span>` anyway, even though the layers panel has no row for it.
    const root = makeRoot(`<div id="wrap"><span class="ph ph-bell"></span></div>`);
    const wrap = root.querySelector("#wrap")!;

    expect(firstChildEmbedElement(wrap)).toBeNull();
  });

  it("still descends into a real subtree that happens to contain inline tags among other block children", () => {
    const root = makeRoot(`<div><span>inline</span><p>block</p></div>`);
    const div = root.querySelector("div")!;
    const span = root.querySelector("span")!;

    // Not leaf-eligible (children aren't ALL inline — <p> is block), so this
    // must still behave like an ordinary subtree, descending to the first
    // navigable child in document order.
    expect(firstChildEmbedElement(div)).toBe(span);
  });
});

describe("parentEmbedElement", () => {
  it("returns the immediate element parent for an ordinary nested element", () => {
    const root = makeRoot(`<div><section><p>a</p></section></div>`);
    const section = root.querySelector("section")!;
    const p = root.querySelector("p")!;

    expect(parentEmbedElement(p, root)).toBe(section);
  });

  it("returns null once climbing reaches root itself", () => {
    const root = makeRoot(`<p>a</p>`);
    const p = root.querySelector("p")!;

    expect(parentEmbedElement(p, root)).toBeNull();
  });

  it("stops at the shadow mount container: a top-level element's parent is null", () => {
    const shadow = makeShadowRoot(`<header>h</header>`);
    const header = shadow.querySelector("header")!;

    expect(parentEmbedElement(header, shadow)).toBeNull();
  });

  it("climbs normally below the mount container once inside real content", () => {
    const shadow = makeShadowRoot(`<section><p>a</p></section>`);
    const section = shadow.querySelector("section")!;
    const p = shadow.querySelector("p")!;

    expect(parentEmbedElement(p, shadow)).toBe(section);
    expect(parentEmbedElement(section, shadow)).toBeNull();
  });

  it("stops at the synthetic body: a top-level element's parent is null", () => {
    const shadow = makeShadowRootWithBody(`<header>h</header>`);
    const header = shadow.querySelector("header")!;

    expect(parentEmbedElement(header, shadow)).toBeNull();
  });

  it("climbs normally below the synthetic body once inside real content", () => {
    const shadow = makeShadowRootWithBody(`<section><p>a</p></section>`);
    const section = shadow.querySelector("section")!;
    const p = shadow.querySelector("p")!;

    expect(parentEmbedElement(p, shadow)).toBe(section);
    expect(parentEmbedElement(section, shadow)).toBeNull();
  });

  it("accepts a custom isContentRoot predicate that overrides the default guess", () => {
    const root = makeRoot(`<div class="fake-root"><p>a</p></div>`);
    const fakeRoot = root.querySelector(".fake-root")!;
    const p = root.querySelector("p")!;

    expect(parentEmbedElement(p, root, (el) => el === fakeRoot)).toBeNull();
  });
});
