import { describe, it, expect, vi } from "vitest";
import {
  applyEmbedElementEdit,
  applyEmbedElementReorder,
  findLiveEmbedElement,
  parseVarReference,
  readEmbedElementSnapshot,
  shadowPathToSourcePath,
  sourcePathToShadowPath,
} from "../embedElementStyle";
import { buildElementPath, resolveElementPath } from "../embedElementPicker";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";

// `sanitizeEmbedHtml`'s own doc comment documents that DOMPurify's tag walk
// "silently no-ops (or drops output entirely)" against a happy-dom
// `DOMParser` document — reproducible with a bare `DOMPurify.sanitize(...)`
// call, independent of anything this module does. `mountHtmlWithBodyStyles`
// calls it unconditionally, so the end-to-end tests below (which need the
// mounted shadow-DOM structure to actually match the source html they hand
// to `applyEmbedElementEdit`) stub it to the identity function — sanitization
// itself is `sanitizeEmbedHtml`'s own concern and is covered by its tests,
// not this module's.
vi.mock("@/utils/sanitizeEmbedHtml", () => ({
  sanitizeEmbedHtml: (html: string) => html,
}));

describe("shadowPathToSourcePath", () => {
  it("strips the synthetic container segment when there is no body wrapper", () => {
    expect(shadowPathToSourcePath("div:nth-of-type(1) > p:nth-of-type(2)")).toBe(
      "p:nth-of-type(2)",
    );
  });

  it("strips the container AND the synthetic body segment when both are present", () => {
    expect(
      shadowPathToSourcePath("div:nth-of-type(1) > body:nth-of-type(1) > span:nth-of-type(1)"),
    ).toBe("span:nth-of-type(1)");
  });

  it("returns '' when the path points at the container itself (no body wrapper)", () => {
    expect(shadowPathToSourcePath("div:nth-of-type(1)")).toBe("");
  });

  it("returns '' when the path points at the synthetic body itself", () => {
    expect(shadowPathToSourcePath("div:nth-of-type(1) > body:nth-of-type(1)")).toBe("");
  });

  it("returns the path unchanged when anchored on a #id", () => {
    expect(shadowPathToSourcePath("#hero > span:nth-of-type(1)")).toBe(
      "#hero > span:nth-of-type(1)",
    );
    expect(shadowPathToSourcePath("#hero")).toBe("#hero");
  });

  it("returns null for an empty path", () => {
    expect(shadowPathToSourcePath("")).toBeNull();
  });

  it("returns null for a malformed/unexpected path", () => {
    expect(shadowPathToSourcePath("span:nth-of-type(1) > p:nth-of-type(1)")).toBeNull();
    expect(shadowPathToSourcePath("garbage")).toBeNull();
  });
});

describe("applyEmbedElementEdit", () => {
  // NOTE on shadow paths below: the mount container `<div>` (the shadow
  // root's sole child, see `EmbedLayer.tsx`) always shows up as the leading
  // "div:nth-of-type(1)" segment, and it corresponds to the source html's
  // own `<body>` (see `shadowPathToSourcePath`'s doc comment) — so a source
  // html with a top-level `<p>` (not wrapped in another `<div>`) means the
  // container's only child is that `<p>` directly.

  it("sets an inline style property", () => {
    const html = `<p>hi</p>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > p:nth-of-type(1)", {
      styles: { color: "red" },
    });
    expect(result).not.toBeNull();
    expect(result!.outerHtml).toContain('style="color: red;"');
    expect(result!.html).toContain('style="color: red;"');
  });

  it("removes a style property via null and drops an empty style attribute", () => {
    const html = `<p style="color: red;">hi</p>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > p:nth-of-type(1)", {
      styles: { color: null },
    });
    expect(result).not.toBeNull();
    expect(result!.outerHtml).not.toContain("style=");
    expect(result!.html).not.toContain("style=");
  });

  it("removes a style property via empty string too", () => {
    const html = `<p style="color: red;">hi</p>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > p:nth-of-type(1)", {
      styles: { color: "" },
    });
    expect(result!.outerHtml).not.toContain("style=");
  });

  it("keeps other declarations when only one is removed", () => {
    const html = `<p style="color: red; font-size: 12px;">hi</p>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > p:nth-of-type(1)", {
      styles: { color: null },
    });
    expect(result!.outerHtml).toContain("font-size: 12px");
    expect(result!.outerHtml).not.toContain("color");
  });

  it("edits text content", () => {
    const html = `<p>old</p>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > p:nth-of-type(1)", {
      text: "new",
    });
    expect(result!.outerHtml).toBe("<p>new</p>");
    expect(result!.html).toContain("<p>new</p>");
  });

  it("returns null and does not mutate the input string for an unresolvable path", () => {
    const html = `<div><p>hi</p></div>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > span:nth-of-type(1)", {
      text: "new",
    });
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>hi</p></div>`);
  });

  it("returns null for an empty/malformed shadow path", () => {
    expect(applyEmbedElementEdit(`<div><p>hi</p></div>`, "", { text: "x" })).toBeNull();
    expect(
      applyEmbedElementEdit(`<div><p>hi</p></div>`, "garbage", { text: "x" }),
    ).toBeNull();
  });

  it("edits the <body> itself when the path resolves to it", () => {
    const html = `<html><head></head><body class="page"><p>hi</p></body></html>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1)", {
      styles: { background: "blue" },
    });
    expect(result).not.toBeNull();
    expect(result!.outerHtml).toContain("<body");
    expect(result!.outerHtml).toContain("background: blue");
  });

  it("returns null for a body-level edit on a bare fragment with no <body>/<html> tag to write it into", () => {
    // Regression: serializing a fragment always emits `doc.body.innerHTML`
    // (see the "bare content fragment" branch below), which drops anything
    // set directly ON <body> on the floor. Before this fix that produced a
    // "successful" edit whose html was byte-identical to the input — the
    // panel showed the edit as applied even though nothing was written.
    const html = `<div><p>hi</p></div>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1)", {
      styles: { background: "blue" },
    });
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>hi</p></div>`);
  });

  it("applies the same body-level edit once a real <body> exists to write it into", () => {
    const html = `<html><head></head><body><p>hi</p></body></html>`;
    const result = applyEmbedElementEdit(html, "div:nth-of-type(1)", {
      styles: { background: "blue" },
    });
    expect(result).not.toBeNull();
    expect(result!.html).toContain("<body style=");
    expect(result!.html).toContain("background: blue");
  });

  describe("preserves document shape", () => {
    it("keeps a full <html> document shape, including a leading doctype", () => {
      const html = `<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>`;
      const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)", {
        text: "new",
      });
      expect(result!.html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(result!.html).toContain("<html");
      expect(result!.html).toContain("<title>T</title>");
      expect(result!.html).toContain("<p>new</p>");
    });

    it("keeps a body-only fragment shape (no <html> wrapper)", () => {
      const html = `<head><style>body{margin:0}</style></head><body><p>hi</p></body>`;
      const result = applyEmbedElementEdit(html, "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)", {
        text: "new",
      });
      expect(result!.html).not.toContain("<html");
      expect(result!.html).toContain("<head>");
      expect(result!.html).toContain("<body");
      expect(result!.html).toContain("<p>new</p>");
    });

    it("keeps a bare content-fragment shape (no <body> tag at all)", () => {
      const html = `<div class="card"><p>hi</p></div>`;
      const result = applyEmbedElementEdit(
        html,
        "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
        { text: "new" },
      );
      expect(result!.html).not.toContain("<html");
      expect(result!.html).not.toContain("<body");
      expect(result!.html).toContain('<div class="card">');
      expect(result!.html).toContain("<p>new</p>");
    });
  });
});

describe("sourcePathToShadowPath", () => {
  it("re-prepends the container prefix (no synthetic body)", () => {
    expect(sourcePathToShadowPath("div:nth-of-type(1) > p:nth-of-type(2)", "p:nth-of-type(1)")).toBe(
      "div:nth-of-type(1) > p:nth-of-type(1)",
    );
  });

  it("re-prepends the container AND synthetic-body prefix when the original path had one", () => {
    expect(
      sourcePathToShadowPath(
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)",
        "p:nth-of-type(1)",
      ),
    ).toBe("div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)");
  });

  it("returns the new path unchanged when it's id-anchored", () => {
    expect(sourcePathToShadowPath("div:nth-of-type(1) > p:nth-of-type(2)", "#hero")).toBe("#hero");
  });

  it("returns the new path unchanged when the original path was itself id-anchored", () => {
    expect(sourcePathToShadowPath("#hero", "p:nth-of-type(3)")).toBe("p:nth-of-type(3)");
  });

  it("re-prepends just the container prefix when the new source path is '' (moved to be the sole/last content)", () => {
    expect(sourcePathToShadowPath("div:nth-of-type(1) > p:nth-of-type(2)", "")).toBe(
      "div:nth-of-type(1)",
    );
  });
});

describe("applyEmbedElementReorder", () => {
  it("moves an element up (before an earlier sibling) on a body fragment", () => {
    const html = `<head></head><body><p>one</p><p>two</p><p>three</p></body>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > p:nth-of-type(2)", // "two"
      "div:nth-of-type(1) > p:nth-of-type(1)", // before "one"
    );
    expect(result).not.toBeNull();
    expect(result!.outerHtml).toBe("<p>two</p>");

    const doc = new DOMParser().parseFromString(result!.html, "text/html");
    const order = Array.from(doc.body.querySelectorAll("p")).map((p) => p.textContent);
    expect(order).toEqual(["two", "one", "three"]);

    // newPath resolves to the SAME element at its new position.
    expect(result!.newPath).toBe("div:nth-of-type(1) > p:nth-of-type(1)");
    const newSourcePath = shadowPathToSourcePath(result!.newPath)!;
    expect(resolveElementPath(doc.body, newSourcePath)?.textContent).toBe("two");
  });

  it("moves an element down (before a later sibling) on a body fragment", () => {
    const html = `<head></head><body><p>one</p><p>two</p><p>three</p></body>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > p:nth-of-type(1)", // "one"
      "div:nth-of-type(1) > p:nth-of-type(3)", // before "three"
    );
    expect(result).not.toBeNull();
    expect(result!.outerHtml).toBe("<p>one</p>");

    const doc = new DOMParser().parseFromString(result!.html, "text/html");
    const order = Array.from(doc.body.querySelectorAll("p")).map((p) => p.textContent);
    expect(order).toEqual(["two", "one", "three"]);

    const newSourcePath = shadowPathToSourcePath(result!.newPath)!;
    expect(resolveElementPath(doc.body, newSourcePath)?.textContent).toBe("one");
  });

  it("moves an element to the end when beforeShadowPath is null", () => {
    const html = `<head></head><body><p>one</p><p>two</p><p>three</p></body>`;
    const result = applyEmbedElementReorder(html, "div:nth-of-type(1) > p:nth-of-type(2)", null);
    expect(result).not.toBeNull();

    const doc = new DOMParser().parseFromString(result!.html, "text/html");
    const order = Array.from(doc.body.querySelectorAll("p")).map((p) => p.textContent);
    expect(order).toEqual(["one", "three", "two"]);

    const newSourcePath = shadowPathToSourcePath(result!.newPath)!;
    expect(resolveElementPath(doc.body, newSourcePath)?.textContent).toBe("two");
  });

  it("preserves a full <html> document shape, including a leading doctype", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><body><p>one</p><p>two</p><p>three</p></body></html>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)", // "two"
      "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)", // before "one"
    );
    expect(result).not.toBeNull();
    expect(result!.html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(result!.html).toContain("<html");
    expect(result!.html).toContain("<title>T</title>");

    const doc = new DOMParser().parseFromString(result!.html, "text/html");
    const order = Array.from(doc.body.querySelectorAll("p")).map((p) => p.textContent);
    expect(order).toEqual(["two", "one", "three"]);

    // newPath carries the container + synthetic-body prefix forward.
    expect(result!.newPath).toBe("div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)");
  });

  it("preserves a bare content-fragment shape (no <body> tag at all)", () => {
    const html = `<p>one</p><p>two</p><p>three</p>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > p:nth-of-type(3)", // "three"
      "div:nth-of-type(1) > p:nth-of-type(1)", // before "one"
    );
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("<html");
    expect(result!.html).not.toContain("<body");

    const doc = new DOMParser().parseFromString(result!.html, "text/html");
    const order = Array.from(doc.body.querySelectorAll("p")).map((p) => p.textContent);
    expect(order).toEqual(["three", "one", "two"]);
  });

  it("returns null when target and before-sibling don't share a parent (stale beforeShadowPath)", () => {
    const html = `<div id="a"><p>x</p></div><div id="b"><p>y</p></div>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)", // p inside div#a
      "div:nth-of-type(1) > div:nth-of-type(2) > p:nth-of-type(1)", // p inside div#b
    );
    expect(result).toBeNull();
  });

  it("returns null for a no-op reorder (element already immediately before the target sibling)", () => {
    const html = `<head></head><body><p>one</p><p>two</p></body>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > p:nth-of-type(1)", // "one" is already right before "two"
      "div:nth-of-type(1) > p:nth-of-type(2)",
    );
    expect(result).toBeNull();
  });

  it("returns null for a no-op reorder onto the end when the element is already last", () => {
    const html = `<head></head><body><p>one</p><p>two</p></body>`;
    const result = applyEmbedElementReorder(html, "div:nth-of-type(1) > p:nth-of-type(2)", null);
    expect(result).toBeNull();
  });

  it("returns null when the target path resolves to the source <body> itself", () => {
    const html = `<html><head></head><body><p>one</p><p>two</p></body></html>`;
    const result = applyEmbedElementReorder(html, "div:nth-of-type(1)", "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)");
    expect(result).toBeNull();
  });

  it("returns null when beforeShadowPath resolves to the source <body> itself", () => {
    const html = `<html><head></head><body><p>one</p><p>two</p></body></html>`;
    const result = applyEmbedElementReorder(html, "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)", "div:nth-of-type(1)");
    expect(result).toBeNull();
  });

  it("returns null for an unresolvable target path, leaving html untouched", () => {
    const html = `<div><p>hi</p></div>`;
    const result = applyEmbedElementReorder(html, "div:nth-of-type(1) > span:nth-of-type(1)", null);
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>hi</p></div>`);
  });

  it("returns null for an unresolvable beforeShadowPath, leaving html untouched", () => {
    const html = `<div><p>a</p><p>b</p></div>`;
    const result = applyEmbedElementReorder(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)", // "a" (resolves fine)
      "div:nth-of-type(1) > div:nth-of-type(1) > span:nth-of-type(1)", // no such element
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>a</p><p>b</p></div>`);
  });
});

describe("readEmbedElementSnapshot: layout-pixel size", () => {
  it("uses the offset box (layout px), not getBoundingClientRect (screen px) — regression for zoomed embeds", () => {
    // Regression for the bug where the size fields were read from
    // `getBoundingClientRect()`. The embed content container carries
    // `transform: scale(viewportZoom)`, so a client rect on a descendant is
    // measured in post-transform SCREEN pixels: at 200% zoom a 100px element
    // read as 200, and writing that back as `width: 200px` doubled the
    // element on the very next edit. `offsetWidth`/`offsetHeight` are the
    // untransformed layout box and round-trip correctly.
    const el = document.createElement("div");
    document.body.appendChild(el);
    Object.defineProperty(el, "offsetWidth", { value: 120, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 80, configurable: true });
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      width: 240,
      height: 160,
      top: 0,
      left: 0,
      right: 240,
      bottom: 160,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect);

    const snap = readEmbedElementSnapshot(el);
    expect(snap.width).toBe(120);
    expect(snap.height).toBe(80);
  });

  it("falls back to computed width/height when the offset box is zero (no layout engine)", () => {
    // happy-dom never runs real layout, so `offsetWidth`/`offsetHeight` are
    // always 0 there — this is the fallback path readEmbedElementSnapshot
    // takes in every other test in this file, exercised explicitly here.
    const el = document.createElement("div");
    el.setAttribute("style", "width: 50px; height: 30px;");
    document.body.appendChild(el);

    const snap = readEmbedElementSnapshot(el);
    expect(snap.width).toBe(50);
    expect(snap.height).toBe(30);
  });
});

describe("readEmbedElementSnapshot: color parsing beyond rgb()", () => {
  it("parses a semi-transparent rgba() to its hex (regression: a naive opaque-only rgb() regex would report '' here)", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "background-color: rgba(10, 20, 30, 0.5);");
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).backgroundColor).toBe("#0a141e");
  });

  it("reports '' for a fully transparent color via isTransparentColor, not a bespoke check", () => {
    const el = document.createElement("div");
    el.setAttribute("style", "background-color: rgba(0, 0, 0, 0);");
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).backgroundColor).toBe("");
  });

  it(
    "documents an environment limitation: a modern color syntax (oklch/lab/color()) does NOT " +
      "round-trip to hex under happy-dom, even though `cssColorToHex` handles it in a real browser",
    () => {
      // `parseColor` intentionally goes through `cssColorToHex` (shared with
      // htmlToDesign) instead of a home-grown rgb()-only regex specifically so
      // that authored `oklch(...)`/`lab(...)`/`color(display-p3 ...)` values —
      // which Chrome preserves verbatim in `getComputedStyle` rather than
      // normalizing to rgb() — are recognized as "a color", not "unset".
      // `cssColorToHex` resolves those through two browser-only mechanisms:
      // a 1x1 <canvas> 2D context's `fillStyle` normalization, and (as a
      // fallback) `getComputedStyle` on a scratch element. Neither works here:
      // `src/test/setup.ts` stubs canvas 2D with a fake context that has no
      // `getImageData`, and happy-dom's own `getComputedStyle` simply drops an
      // unrecognized `background-color` value (reports "") and echoes an
      // unrecognized `color` value back verbatim rather than resolving it — so
      // in THIS test environment the value never reaches the hex regex as
      // anything matchable, and `parseColor` legitimately returns "".
      // This test pins that known gap rather than silently skipping it: if a
      // real conversion ever starts working here (e.g. a happy-dom upgrade),
      // this assertion is the one that will fail and should be revisited.
      const el = document.createElement("div");
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      expect(cs.backgroundColor).toBe(""); // happy-dom drops the unrecognized value entirely
      const spy = vi
        .spyOn(window, "getComputedStyle")
        .mockReturnValue({ ...cs, backgroundColor: "oklch(0.7 0.1 200)" } as CSSStyleDeclaration);
      try {
        expect(readEmbedElementSnapshot(el).backgroundColor).toBe("");
      } finally {
        spy.mockRestore();
      }
    },
  );
});

describe("parseVarReference", () => {
  it("parses a bare var(--name) reference", () => {
    expect(parseVarReference("var(--brand-500)")).toBe("--brand-500");
  });

  it("parses var(--name, fallback) and ignores the fallback", () => {
    expect(parseVarReference("var(--brand-500, #fff)")).toBe("--brand-500");
    expect(parseVarReference("var(--brand-500, rgba(0, 0, 0, 0.5))")).toBe("--brand-500");
  });

  it("tolerates surrounding/internal whitespace", () => {
    expect(parseVarReference("  var( --brand-500 )  ")).toBe("--brand-500");
    expect(parseVarReference("var(--brand-500 , #fff)")).toBe("--brand-500");
  });

  it("returns null for a plain color value", () => {
    expect(parseVarReference("#ff0000")).toBeNull();
    expect(parseVarReference("rgb(255, 0, 0)")).toBeNull();
  });

  it("returns null for empty/nullish input", () => {
    expect(parseVarReference("")).toBeNull();
    expect(parseVarReference(null)).toBeNull();
    expect(parseVarReference(undefined)).toBeNull();
  });
});

describe("readEmbedElementSnapshot: variable bindings", () => {
  function makeStyledEl(styleAttr: string): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("style", styleAttr);
    document.body.appendChild(el);
    return el;
  }

  it("reports the bound variable name for background-color/color/border-color", () => {
    const el = makeStyledEl(
      "background-color: var(--brand-500); color: var(--text-primary); border-color: var(--brand-500, #fff);",
    );
    const snap = readEmbedElementSnapshot(el);
    expect(snap.varBindings).toEqual({
      backgroundColor: "--brand-500",
      color: "--text-primary",
      borderColor: "--brand-500",
    });
  });

  it("omits a key when the corresponding property is a plain color, not a variable", () => {
    const el = makeStyledEl("background-color: #ff0000;");
    const snap = readEmbedElementSnapshot(el);
    expect(snap.varBindings).toEqual({});
  });

  it("omits a key when the corresponding property is unset", () => {
    const el = makeStyledEl("");
    const snap = readEmbedElementSnapshot(el);
    expect(snap.varBindings).toEqual({});
  });

  // F4 regression: the backend's own prompt now tells the model to author
  // `background: var(--brand)` (the shorthand) rather than the
  // `background-color` longhand this panel itself writes. Without a
  // fallback, that reads as unbound — `getPropertyValue("background-color")`
  // comes back empty for a shorthand containing a `var()` reference (a
  // "pending-substitution value" per spec) — so the Fill row would silently
  // let a user overwrite the binding instead of showing it as bound.
  it("falls back to the `background` shorthand when the longhand is empty and the whole value is a single var()", () => {
    const el = makeStyledEl("background: var(--brand-500);");
    const snap = readEmbedElementSnapshot(el);
    expect(snap.varBindings.backgroundColor).toBe("--brand-500");
  });

  it("does NOT report a binding from a multi-part background shorthand (a var() there may size an image, not a color)", () => {
    const el = makeStyledEl("background: url(photo.png) center / cover no-repeat;");
    const snap = readEmbedElementSnapshot(el);
    expect(snap.varBindings.backgroundColor).toBeUndefined();
  });

  it("prefers the background-color longhand over the shorthand when both are present", () => {
    // Longhand declared after the shorthand in the same style attribute wins
    // the cascade and is what the browser reflects back for the longhand
    // getter — the panel's own edit path always writes only the longhand
    // (see setBorder's sibling handling for background-color), so this is
    // the shape a normal edit-then-read round trip produces.
    const el = makeStyledEl("background: var(--brand-500); background-color: var(--accent-200);");
    const snap = readEmbedElementSnapshot(el);
    expect(snap.varBindings.backgroundColor).toBe("--accent-200");
  });
});

describe("readEmbedElementSnapshot: void elements never report editable text", () => {
  it("reports null text for a void element (<img>), not ''", () => {
    // Regression: setting `textContent` on an <img>/<input>/<br>/etc mutates
    // a node whose serialization never emits children, so an edit made
    // through the old '' (editable, empty) signal would silently vanish from
    // the html on the next write.
    const el = document.createElement("img");
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).text).toBeNull();
  });

  it("reports non-null text for <textarea> — its text IS its value and serializes normally", () => {
    const el = document.createElement("textarea");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).text).toBe("hello");
  });

  it("reports non-null text for <option> — same reasoning as <textarea>", () => {
    const el = document.createElement("option");
    el.textContent = "Choice";
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).text).toBe("Choice");
  });

  it("reports a string for an ordinary childless <span> with text", () => {
    const el = document.createElement("span");
    el.textContent = "plain text";
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).text).toBe("plain text");
  });
});

describe("readEmbedElementSnapshot", () => {
  function makeEl(styleAttr: string, inner = "text"): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("style", styleAttr);
    el.id = "target";
    el.className = "a b";
    el.innerHTML = inner;
    document.body.appendChild(el);
    return el;
  }

  it("reads inline-styled box/typography/color properties", () => {
    const el = makeEl(
      `display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: space-between;
       padding: 1px 2px 3px 4px; opacity: 0.5; border-radius: 6px; background-color: rgb(255, 0, 0);
       border: 2px solid rgb(0, 0, 255); font-size: 14px; font-weight: 700; line-height: 20px;
       letter-spacing: 1px; text-align: center; color: rgb(10, 20, 30);`,
    );

    const snap = readEmbedElementSnapshot(el);
    expect(snap.tagName).toBe("div");
    expect(snap.elementId).toBe("target");
    expect(snap.classes).toEqual(["a", "b"]);
    expect(snap.display).toBe("flex");
    expect(snap.flexDirection).toBe("column");
    expect(snap.gap).toBe(8);
    expect(snap.alignItems).toBe("center");
    expect(snap.justifyContent).toBe("space-between");
    expect(snap.padding).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(snap.opacity).toBe(0.5);
    expect(snap.borderRadius).toBe(6);
    expect(snap.backgroundColor).toBe("#ff0000");
    expect(snap.borderWidth).toBe(2);
    expect(snap.borderColor).toBe("#0000ff");
    expect(snap.borderStyle).toBe("solid");
    expect(snap.fontSize).toBe(14);
    expect(snap.fontWeight).toBe(700);
    expect(snap.lineHeight).toBe(20);
    expect(snap.letterSpacing).toBe(1);
    expect(snap.textAlign).toBe("center");
    expect(snap.color).toBe("#0a141e");
    expect(snap.text).toBe("text");
  });

  it("reports '' for a fully transparent background", () => {
    const el = makeEl("background-color: transparent;");
    expect(readEmbedElementSnapshot(el).backgroundColor).toBe("");
  });

  it("reports 0 for 'normal' line-height/letter-spacing/gap", () => {
    const el = makeEl("line-height: normal; letter-spacing: normal;");
    const snap = readEmbedElementSnapshot(el);
    expect(snap.lineHeight).toBe(0);
    expect(snap.letterSpacing).toBe(0);
    expect(snap.gap).toBe(0);
  });

  it("reports null text when the element has child elements", () => {
    const el = makeEl("", "<span>inner</span>");
    expect(readEmbedElementSnapshot(el).text).toBeNull();
  });

  it("reports '' text for an empty, childless element", () => {
    const el = makeEl("", "");
    expect(readEmbedElementSnapshot(el).text).toBe("");
  });

  it("omits elementId when the element has no id", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    expect(readEmbedElementSnapshot(el).elementId).toBeUndefined();
  });
});

describe("end-to-end: shadow mount -> path -> translated path -> edit", () => {
  // Each mount gets its own embed id and its host is appended to
  // `document.body` for the lifetime of the module-level jsdom/happy-dom
  // document (no per-test cleanup here) — a shared id across tests would
  // make `document.querySelector('[data-embed-id="…"]')` in
  // `findLiveEmbedElement` resolve to an earlier test's leftover host.
  function mountInShadow(embedId: string, html: string, width = 300, height = 200) {
    const host = document.createElement("div");
    host.setAttribute("data-embed-id", embedId);
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const content = document.createElement("div");
    mountHtmlWithBodyStyles(content, html, width, height);
    shadow.appendChild(content);
    return { host, shadow };
  }

  it("resolves the same element without a body wrapper (no body-targeted styles)", () => {
    const html = `<div class="card"><p>one</p><p>two</p></div>`;
    const { shadow } = mountInShadow("embed-no-body", html);

    const target = shadow.querySelectorAll("p")[1];
    const shadowPath = buildElementPath(target, shadow);

    // findLiveEmbedElement resolves the SAME live node via the raw shadow path.
    expect(findLiveEmbedElement("embed-no-body", shadowPath)).toBe(target);

    const sourcePath = shadowPathToSourcePath(shadowPath);
    expect(sourcePath).not.toBeNull();

    const edited = applyEmbedElementEdit(html, shadowPath, { text: "TWO" });
    expect(edited).not.toBeNull();
    expect(edited!.outerHtml).toBe("<p>TWO</p>");
    // Confirm it targeted the *second* <p>, not the first.
    expect(edited!.html).toContain("<p>one</p>");
    expect(edited!.html).toContain("<p>TWO</p>");
  });

  it("resolves the same element with a synthetic body wrapper (body-targeted styles)", () => {
    // `hasBodyTargetedStyles` treats a CSS selector targeting `html`/`body`
    // as body-targeted even with no literal `<body>` tag in the markup —
    // used here deliberately: a literal `<body>` tag routes
    // `mountHtmlWithBodyStyles`'s own `sanitizeEmbedHtml` call through
    // DOMPurify's WHOLE_DOCUMENT path, which is unusable under happy-dom
    // (see the note atop `sanitizeEmbedHtml.ts` and
    // `embedHtmlUtils.lazyImages.test.ts`). This form still exercises the
    // synthetic-`<body>`-creation branch of `mountHtmlWithBodyStyles`.
    const html = `<style>html, body { margin: 0; }</style><div class="card"><p>one</p><p>two</p></div>`;
    const { shadow } = mountInShadow("embed-with-body", html);

    const target = shadow.querySelectorAll("p")[1];
    const shadowPath = buildElementPath(target, shadow);
    expect(shadowPath).toContain("body:nth-of-type(1)");

    expect(findLiveEmbedElement("embed-with-body", shadowPath)).toBe(target);

    const edited = applyEmbedElementEdit(html, shadowPath, { text: "TWO" });
    expect(edited).not.toBeNull();
    expect(edited!.outerHtml).toBe("<p>TWO</p>");
    expect(edited!.html).toContain("<p>one</p>");
    expect(edited!.html).toContain("<p>TWO</p>");
    // No literal <html>/<body> tag in the source — the fragment shape is
    // preserved rather than promoted to a full document.
    expect(edited!.html).not.toContain("<html");
    expect(edited!.html).not.toContain("<body");
  });
});
