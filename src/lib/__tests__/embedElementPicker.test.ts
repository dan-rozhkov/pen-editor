import { describe, it, expect } from "vitest";
import {
  buildElementPath,
  resolveElementPath,
  resolvePickableElement,
  describeEmbedElement,
} from "../embedElementPicker";

function makeRoot(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("embedElementPicker", () => {
  describe("buildElementPath / resolveElementPath round-trip", () => {
    it("round-trips a plain nested element via nth-of-type segments", () => {
      const root = makeRoot(`
        <div class="card">
          <p>one</p>
          <p>two</p>
          <button>Click</button>
        </div>
      `);
      const button = root.querySelector("button")!;
      const path = buildElementPath(button, root);
      expect(path).toBe("div:nth-of-type(1) > button:nth-of-type(1)");
      expect(resolveElementPath(root, path)).toBe(button);

      const secondP = root.querySelectorAll("p")[1];
      const pPath = buildElementPath(secondP, root);
      expect(pPath).toBe("div:nth-of-type(1) > p:nth-of-type(2)");
      expect(resolveElementPath(root, pPath)).toBe(secondP);
    });

    it("anchors on a safe, unique id and stops walking further up", () => {
      const root = makeRoot(`
        <section>
          <div id="hero">
            <span>Hi</span>
          </div>
        </section>
      `);
      const span = root.querySelector("span")!;
      const path = buildElementPath(span, root);
      expect(path).toBe("#hero > span:nth-of-type(1)");
      expect(resolveElementPath(root, path)).toBe(span);
    });

    it("does not anchor on an id that isn't unique under root", () => {
      const root = makeRoot(`
        <div>
          <p id="dup">a</p>
        </div>
        <div>
          <p id="dup">b</p>
        </div>
      `);
      const target = root.querySelectorAll("p")[1];
      const path = buildElementPath(target, root);
      expect(path).not.toContain("#dup");
      expect(resolveElementPath(root, path)).toBe(target);
    });

    it("does not anchor on an id that isn't a safe CSS identifier", () => {
      const root = makeRoot(`<div id="123-bad"><span>x</span></div>`);
      const span = root.querySelector("span")!;
      const path = buildElementPath(span, root);
      expect(path).not.toContain("#123-bad");
      expect(resolveElementPath(root, path)).toBe(span);
    });

    it("returns '' for the root itself, which never resolves to anything", () => {
      const root = makeRoot(`<p>x</p>`);
      expect(buildElementPath(root, root)).toBe("");
      expect(resolveElementPath(root, "")).toBeNull();
    });

    it("resolveElementPath returns null for an invalid selector instead of throwing", () => {
      const root = makeRoot(`<p>x</p>`);
      expect(resolveElementPath(root, ":::not-a-selector")).toBeNull();
    });

    it("resolveElementPath returns null when the path no longer matches", () => {
      const root = makeRoot(`<div><p>x</p></div>`);
      expect(resolveElementPath(root, "div:nth-of-type(1) > span:nth-of-type(1)")).toBeNull();
    });

    it("round-trips through a real ShadowRoot boundary without dropping the top-level segment", () => {
      // Mirrors production: EmbedLayer's `root` is `host.shadowRoot`, and the
      // mounted content div's `parentElement` is null there (only its
      // `parentNode` — the shadow root — is set). A path built with
      // `parentElement` would exit after zero segments (""), which
      // `resolveElementPath` also refuses to resolve — this asserts the real
      // (non-empty, rooted) path instead.
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <div class="content">
          <p>one</p>
          <p>two</p>
          <button>Click</button>
        </div>
      `;
      const button = shadow.querySelector("button")!;

      const path = buildElementPath(button, shadow);
      expect(path).not.toBe("");
      expect(path).toBe("div:nth-of-type(1) > button:nth-of-type(1)");
      expect(resolveElementPath(shadow, path)).toBe(button);
    });

    it("resolves the exact chain inside a ShadowRoot even when an identical chain exists elsewhere earlier in document order", () => {
      // Two sibling `div > p` chains under the shadow root: the intended
      // target is the SECOND one. A naive `root.querySelector(path)` with a
      // bare (non-`:scope`) descendant selector would match the FIRST
      // matching `div > p` chain instead — this is the "wrong element"
      // failure mode from the code review.
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <section class="footer">
          <div><p>decoy</p></div>
        </section>
        <div class="card">
          <div><p>intended</p></div>
        </div>
      `;
      const intended = shadow.querySelector(".card p")!;

      const path = buildElementPath(intended, shadow);
      const resolved = resolveElementPath(shadow, path);
      expect(resolved).toBe(intended);
      expect(resolved?.textContent).toBe("intended");
    });
  });

  describe("resolvePickableElement", () => {
    it("returns the element itself when it's a valid direct hit", () => {
      const root = makeRoot(`<div><button>Go</button></div>`);
      const button = root.querySelector("button")!;
      expect(resolvePickableElement(button, root)).toBe(button);
    });

    it("walks up from a text node to its element", () => {
      const root = makeRoot(`<div><span>hello</span></div>`);
      const span = root.querySelector("span")!;
      const textNode = span.firstChild!;
      expect(resolvePickableElement(textNode, root)).toBe(span);
    });

    it("skips a script element and walks up to its parent", () => {
      const root = makeRoot(`<div><script>1</script></div>`);
      const script = root.querySelector("script")!;
      const div = root.querySelector("div")!;
      expect(resolvePickableElement(script, root)).toBe(div);
    });

    it("skips a style element and walks up to its parent", () => {
      const root = makeRoot(`<div><style>.a{}</style></div>`);
      const style = root.querySelector("style")!;
      const div = root.querySelector("div")!;
      expect(resolvePickableElement(style, root)).toBe(div);
    });

    it("returns null when the target is the content root itself", () => {
      const root = makeRoot(`<p>x</p>`);
      expect(resolvePickableElement(root, root)).toBeNull();
    });

    it("returns null for a non-Node target", () => {
      const root = makeRoot(`<p>x</p>`);
      expect(resolvePickableElement(null, root)).toBeNull();
    });

    it("returns null for a node outside root's subtree, even though it isn't root itself", () => {
      // A node that is an ancestor of root (e.g. the shadow host, whose
      // shadowRoot IS root) is not contained in root — `node !== root` is
      // trivially true for it, but it must still be rejected: it isn't
      // "inside root" the way the doc comment promises.
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      const root = document.createElement("div");
      document.body.appendChild(root);
      root.innerHTML = `<span>hi</span>`;

      expect(resolvePickableElement(outside, root)).toBeNull();
    });

    it("returns null for the shadow host when root is that host's shadowRoot", () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<div><button>Go</button></div>`;

      // The host itself is not a descendant of its own shadow root.
      expect(resolvePickableElement(host, shadow)).toBeNull();
      // But content mounted inside the shadow root still resolves normally.
      const button = shadow.querySelector("button")!;
      expect(resolvePickableElement(button, shadow)).toBe(button);
    });
  });

  describe("describeEmbedElement", () => {
    it("captures tag, id, classes, path, and embedId", () => {
      const root = makeRoot(`<div><button id="cta" class="btn primary">Buy now</button></div>`);
      const button = root.querySelector("button")!;
      const result = describeEmbedElement(button, root, "embed-1");
      expect(result.embedId).toBe("embed-1");
      expect(result.tagName).toBe("button");
      expect(result.elementId).toBe("cta");
      expect(result.classes).toEqual(["btn", "primary"]);
      expect(result.path).toBe(buildElementPath(button, root));
      expect(result.textPreview).toBe("Buy now");
    });

    it("omits elementId when the element has no id", () => {
      const root = makeRoot(`<div><span>hi</span></div>`);
      const span = root.querySelector("span")!;
      const result = describeEmbedElement(span, root, "e1");
      expect(result.elementId).toBeUndefined();
    });

    it("collapses whitespace in textPreview and truncates it around 120 chars", () => {
      const root = makeRoot(`<div><p>${"word ".repeat(60)}</p></div>`);
      const p = root.querySelector("p")!;
      const result = describeEmbedElement(p, root, "e1");
      expect(result.textPreview.length).toBeLessThanOrEqual(121);
      expect(result.textPreview.endsWith("…")).toBe(true);
      expect(result.textPreview).not.toMatch(/\s{2,}/);
    });

    it("truncates outerHtml around 1200 chars with a trailing ellipsis marker", () => {
      const root = makeRoot(`<div><p class="x">${"a".repeat(2000)}</p></div>`);
      const p = root.querySelector("p")!;
      const result = describeEmbedElement(p, root, "e1");
      expect(result.outerHtml.length).toBeLessThanOrEqual(1201);
      expect(result.outerHtml.endsWith("…")).toBe(true);
    });

    it("does not truncate a short outerHtml", () => {
      const root = makeRoot(`<div><span>hi</span></div>`);
      const span = root.querySelector("span")!;
      const result = describeEmbedElement(span, root, "e1");
      expect(result.outerHtml).toBe("<span>hi</span>");
      expect(result.outerHtml.endsWith("…")).toBe(false);
    });
  });
});
