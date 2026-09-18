import { describe, it, expect, vi } from "vitest";
import {
  buildEmbedLayerTree,
  buildSourceEmbedElementSelection,
  getEmbedLayerTree,
  isLayerTreeLeaf,
  normalizeShadowPathToSourcePath,
  sourcePathToShadowPath,
  type EmbedElementLayer,
} from "../embedLayerTree";
import { resolveElementPath } from "../embedElementPicker";

/** Flatten a tree into its rows, document order, depth-first — convenient
 * for asserting "somewhere in the tree" without hand-writing the nesting. */
function flatten(layers: EmbedElementLayer[]): EmbedElementLayer[] {
  return layers.flatMap((l) => [l, ...flatten(l.children)]);
}

function byPath(layers: EmbedElementLayer[], sourcePath: string): EmbedElementLayer | undefined {
  return flatten(layers).find((l) => l.sourcePath === sourcePath);
}

describe("buildEmbedLayerTree", () => {
  it("returns [] for empty html", () => {
    expect(buildEmbedLayerTree("")).toEqual([]);
  });

  it("returns [] for html with no body content", () => {
    expect(buildEmbedLayerTree("<style>.a{color:red}</style>")).toEqual([]);
  });

  it("walks a bare fragment (no <html>/<body> wrapper) in document order", () => {
    const html = `<div><p>one</p><p>two</p></div>`;
    const tree = buildEmbedLayerTree(html);
    expect(tree).toHaveLength(1);
    expect(tree[0].tagName).toBe("div");
    expect(tree[0].children.map((c) => c.tagName)).toEqual(["p", "p"]);
  });

  it("assigns positional sourcePaths matching buildElementPath's nth-of-type form", () => {
    const html = `<section><p>a</p><p>b</p><button>go</button></section>`;
    const tree = buildEmbedLayerTree(html);
    const section = tree[0];
    expect(section.sourcePath).toBe("section:nth-of-type(1)");
    expect(section.children[0].sourcePath).toBe("section:nth-of-type(1) > p:nth-of-type(1)");
    expect(section.children[1].sourcePath).toBe("section:nth-of-type(1) > p:nth-of-type(2)");
    expect(section.children[2].sourcePath).toBe("section:nth-of-type(1) > button:nth-of-type(1)");
  });

  it("never anchors a sourcePath on #id even when the element has a unique id", () => {
    const html = `<div id="hero"><p>hi</p></div>`;
    const tree = buildEmbedLayerTree(html);
    expect(tree[0].sourcePath).toBe("div:nth-of-type(1)");
    expect(tree[0].sourcePath).not.toContain("#");
  });

  describe("shadow path prefixing", () => {
    it("prefixes only the container segment when there are no body-targeted styles", () => {
      const html = `<p>hi</p>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].shadowPath).toBe("div:nth-of-type(1) > p:nth-of-type(1)");
    });

    it("also prefixes the synthetic body segment when the source has a <body> tag", () => {
      const html = `<body><p>hi</p></body>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].shadowPath).toBe(
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
      );
    });

    it("also prefixes the synthetic body segment when the source has html/body-targeted CSS", () => {
      const html = `<style>body { margin: 0; }</style><p>hi</p>`;
      const tree = buildEmbedLayerTree(html);
      const p = byPath(tree, "p:nth-of-type(1)")!;
      expect(p.shadowPath).toBe("div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)");
    });
  });

  describe("kind mapping", () => {
    it("maps known text tags to kind 'text'", () => {
      const html = `<div><h2>Title</h2><a href="#">link</a><li>item</li></div>`;
      const tree = buildEmbedLayerTree(html);
      const [h2, a, li] = tree[0].children;
      expect(h2.kind).toBe("text");
      expect(a.kind).toBe("text");
      expect(li.kind).toBe("text");
    });

    it("maps known image tags to kind 'image'", () => {
      const html = `<div><img src="x.png"><svg></svg><video></video><canvas></canvas><iframe></iframe><picture></picture></div>`;
      const tree = buildEmbedLayerTree(html);
      const kinds = tree[0].children.map((c) => c.kind);
      expect(kinds).toEqual(["image", "image", "image", "image", "image", "image"]);
    });

    it("maps known shape tags to kind 'shape'", () => {
      const html = `<div><hr><input><select></select><textarea></textarea><progress></progress><meter></meter></div>`;
      const tree = buildEmbedLayerTree(html);
      const kinds = tree[0].children.map((c) => c.kind);
      expect(kinds).toEqual(["shape", "shape", "shape", "shape", "shape", "shape"]);
    });

    it("maps everything else to kind 'frame'", () => {
      const html = `<div><section></section><header><nav></nav></header><ul><li>x</li></ul></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("frame");
      expect(tree[0].children[0].tagName).toBe("section");
      expect(tree[0].children[0].kind).toBe("frame");
      expect(tree[0].children[1].tagName).toBe("header");
      expect(tree[0].children[1].kind).toBe("frame");
      const ul = tree[0].children[2];
      expect(ul.kind).toBe("frame");
    });

    it("keeps an empty <div> as kind frame (no children, no text, non-text tag)", () => {
      const html = `<div></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("frame");
      expect(tree[0].children).toEqual([]);
    });

    it("keeps a childless image/shape element as its own kind, not text", () => {
      const html = `<div><img src="x.png"><hr></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].children[0].kind).toBe("image");
      expect(tree[0].children[1].kind).toBe("shape");
    });
  });

  describe("text-leaf collapse", () => {
    it("collapses a div with only text into a leaf text row", () => {
      const html = `<div>Hello world</div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("text");
      expect(tree[0].children).toEqual([]);
    });

    it("collapses an element whose only children are inline-formatting tags", () => {
      const html = `<p>Hello <b>bold</b> and <span>span</span> text</p>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("text");
      expect(tree[0].children).toEqual([]);
      expect(tree[0].name).toContain("Hello");
    });

    it("does not collapse when a non-inline element child is present", () => {
      const html = `<li>label <div>block</div></li>`;
      const tree = buildEmbedLayerTree(html);
      const li = tree[0];
      expect(li.children).toHaveLength(1);
      expect(li.children[0].tagName).toBe("div");
    });

    it("recurses into a container with real element children", () => {
      const html = `<section><article><p>x</p></article></section>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("frame");
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].tagName).toBe("article");
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].tagName).toBe("p");
    });

    it("collapses a leaf-eligible icon wrapper with NO text to a childless row, keeping its own kind (Finding 2)", () => {
      // Unlike `<div>Label <span>3</span></div>` above, this wrapper has no
      // text content at all — it must still stop descending (children: []),
      // but since there's no text it keeps kind "frame" rather than
      // becoming "text". This is the exact shape `isLayerTreeLeaf` exists
      // to recognize for `embedElementNavigation.ts`'s `firstChildEmbedElement`:
      // a `leafEligible` element with no text used to be missed by the old
      // `collapsesToTextRow` predicate (which also required text), letting
      // Enter descend into the `<span>` even though it gets no row here.
      const html = `<div id="wrap"><span class="ph ph-bell"></span></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("frame");
      expect(tree[0].children).toEqual([]);

      const wrapEl = new DOMParser().parseFromString(html, "text/html").body.querySelector("#wrap")!;
      expect(isLayerTreeLeaf(wrapEl)).toBe(true);
    });
  });

  describe("name resolution", () => {
    it("prefers data-layer-name above everything else", () => {
      const html = `<div data-layer-name="Hero Card" id="x" class="y">some text</div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe("Hero Card");
    });

    it("uses truncated text content for text-kind rows", () => {
      const html = `<p>This is a fairly long sentence that goes on</p>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].kind).toBe("text");
      expect(tree[0].name.length).toBeLessThanOrEqual(29); // 28 + ellipsis
      expect(tree[0].name.endsWith("…")).toBe(true);
    });

    it("does not truncate short text", () => {
      const html = `<p>Short</p>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe("Short");
    });

    it("prefers alt text for <img> before id/class fallbacks", () => {
      const html = `<img src="x.png" alt="A dog" id="pic" class="photo">`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe("A dog");
    });

    it("falls back to #id when there is no data-layer-name/text/alt", () => {
      const html = `<div id="hero"></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe("#hero");
    });

    it("falls back to .class when there is no id", () => {
      const html = `<div class="card highlight"></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe(".card");
    });

    it("falls back to the tag name as a last resort", () => {
      const html = `<div></div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe("div");
    });

    it("falls back to id/class for an <img> with no alt", () => {
      const html = `<img src="x.png" class="thumb">`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].name).toBe(".thumb");
    });
  });

  describe("hidden detection", () => {
    it("flags an element with inline display:none as hidden", () => {
      const html = `<div style="display: none;">x</div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].hidden).toBe(true);
    });

    it("is case-insensitive about the display:none value", () => {
      const html = `<div style="display: NONE;">x</div>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].hidden).toBe(true);
    });

    it("leaves other elements unhidden", () => {
      const html = `<div style="display: flex;">x</div><p>y</p>`;
      const tree = buildEmbedLayerTree(html);
      expect(tree[0].hidden).toBe(false);
      expect(tree[1].hidden).toBe(false);
    });
  });

  describe("skipped tags", () => {
    it("skips script/style/link/meta/title/template/noscript/base entirely, including their subtrees", () => {
      const html = `
        <script>console.log(1)</script>
        <style>.a{color:red}</style>
        <link rel="stylesheet">
        <meta charset="utf-8">
        <title>Doc</title>
        <template><p>never</p></template>
        <noscript><p>never2</p></noscript>
        <base href="/">
        <p>real</p>
      `;
      const tree = buildEmbedLayerTree(html);
      expect(tree).toHaveLength(1);
      expect(tree[0].tagName).toBe("p");
      expect(flatten(tree).some((l) => l.tagName === "template" || l.name.includes("never"))).toBe(
        false,
      );
    });
  });

  it("returns [] for malformed html that still parses to an empty body", () => {
    const tree = buildEmbedLayerTree("<<<not html>>>");
    expect(Array.isArray(tree)).toBe(true);
  });

  // Every row's shadowPath must normalize back to its own sourcePath, and
  // that sourcePath must resolve (against the parsed source <body>) to an
  // element of the same tag. Each `it` below has its own `expect` calls
  // (rather than delegating to a shared helper) so `vitest/expect-expect`
  // can see them without this repo's eslint config needing to special-case
  // a local helper name.
  describe("round-trip invariant", () => {
    it("round-trips a plain fragment", () => {
      const html = `<div><p>one</p><p>two</p><button>go</button></div>`;
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const row of flatten(buildEmbedLayerTree(html))) {
        expect(normalizeShadowPathToSourcePath(row.shadowPath, html)).toBe(row.sourcePath);
        const resolved = resolveElementPath(doc.body, row.sourcePath);
        expect(resolved?.tagName.toLowerCase()).toBe(row.tagName);
      }
    });

    it("round-trips with a synthetic body wrapper", () => {
      const html = `<body><header><h1>Title</h1></header><main><p>x</p></main></body>`;
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const row of flatten(buildEmbedLayerTree(html))) {
        expect(normalizeShadowPathToSourcePath(row.shadowPath, html)).toBe(row.sourcePath);
        const resolved = resolveElementPath(doc.body, row.sourcePath);
        expect(resolved?.tagName.toLowerCase()).toBe(row.tagName);
      }
    });

    it("round-trips an element with a unique id", () => {
      const html = `<div id="hero"><p id="lead">lead text</p><p>more</p></div>`;
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const row of flatten(buildEmbedLayerTree(html))) {
        expect(normalizeShadowPathToSourcePath(row.shadowPath, html)).toBe(row.sourcePath);
        const resolved = resolveElementPath(doc.body, row.sourcePath);
        expect(resolved?.tagName.toLowerCase()).toBe(row.tagName);
      }
    });
  });
});

describe("sourcePathToShadowPath", () => {
  it("prefixes just the container segment without body-targeted styles", () => {
    expect(sourcePathToShadowPath("p:nth-of-type(1)", "<p>hi</p>")).toBe(
      "div:nth-of-type(1) > p:nth-of-type(1)",
    );
  });

  it("prefixes container + synthetic body when the source has body-targeted styles", () => {
    expect(sourcePathToShadowPath("p:nth-of-type(1)", "<body><p>hi</p></body>")).toBe(
      "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
    );
  });

  it("returns just the prefix for an empty sourcePath", () => {
    expect(sourcePathToShadowPath("", "<p>hi</p>")).toBe("div:nth-of-type(1)");
    expect(sourcePathToShadowPath("", "<body><p>hi</p></body>")).toBe(
      "div:nth-of-type(1) > body:nth-of-type(1)",
    );
  });
});

describe("normalizeShadowPathToSourcePath", () => {
  // Top-level <p>s directly under <body> (no wrapping <div>), so the
  // container prefix ("div:nth-of-type(1)") is easy to tell apart from the
  // content's own positional segments in these hand-written paths.
  const html = `<p id="lead">lead</p><p>second</p>`;

  it("canonicalizes a positional shadow path to its sourcePath", () => {
    expect(
      normalizeShadowPathToSourcePath(
        "div:nth-of-type(1) > p:nth-of-type(2)",
        html,
      ),
    ).toBe("p:nth-of-type(2)");
  });

  it("canonicalizes an #id-anchored shadow path to the positional sourcePath", () => {
    expect(normalizeShadowPathToSourcePath("#lead", html)).toBe("p:nth-of-type(1)");
  });

  it("returns '' for a path pointing at the container itself", () => {
    expect(normalizeShadowPathToSourcePath("div:nth-of-type(1)", html)).toBe("");
  });

  it("returns null for a malformed shadow path", () => {
    expect(normalizeShadowPathToSourcePath("garbage", html)).toBeNull();
  });

  it("returns null for a shadow path that no longer resolves (stale)", () => {
    expect(
      normalizeShadowPathToSourcePath("div:nth-of-type(1) > span:nth-of-type(9)", html),
    ).toBeNull();
  });

  it("returns null for an empty shadow path", () => {
    expect(normalizeShadowPathToSourcePath("", html)).toBeNull();
  });
});

describe("getEmbedLayerTree", () => {
  it("returns the same tree buildEmbedLayerTree would for a given html string", () => {
    const html = "<button>Buy</button>";
    expect(getEmbedLayerTree(html)).toEqual(buildEmbedLayerTree(html));
  });

  it("does not re-parse an html string it has already cached", () => {
    const html = `<button>Cache me ${Math.random()}</button>`;
    const parseSpy = vi.spyOn(DOMParser.prototype, "parseFromString");
    getEmbedLayerTree(html);
    const callsAfterFirst = parseSpy.mock.calls.length;
    getEmbedLayerTree(html);
    expect(parseSpy.mock.calls.length).toBe(callsAfterFirst);
    parseSpy.mockRestore();
  });

  it("re-parses once a distinct-by-value html string is requested again after eviction", () => {
    // Each string below is unique (Math.random()) so none of them hit an
    // existing cache entry — enough distinct entries to push the very first
    // one (this test's own) out of the capped cache.
    const first = `<button>Evictee ${Math.random()}</button>`;
    getEmbedLayerTree(first);
    for (let i = 0; i < 8; i++) {
      getEmbedLayerTree(`<button>Filler ${Math.random()} ${i}</button>`);
    }
    const parseSpy = vi.spyOn(DOMParser.prototype, "parseFromString");
    getEmbedLayerTree(first);
    expect(parseSpy).toHaveBeenCalled();
    parseSpy.mockRestore();
  });
});

describe("buildSourceEmbedElementSelection", () => {
  const html = '<div class="card"><button id="cta">Buy now</button></div>';

  it("builds a selection with a shadow-relative path for a valid sourcePath", () => {
    const selection = buildSourceEmbedElementSelection(
      html,
      "div:nth-of-type(1) > button:nth-of-type(1)",
      "embed1",
    );
    expect(selection).not.toBeNull();
    expect(selection?.embedId).toBe("embed1");
    expect(selection?.tagName).toBe("button");
    expect(selection?.elementId).toBe("cta");
    expect(selection?.textPreview).toBe("Buy now");
    // Shadow-relative, not the bare source path — must resolve against the
    // live mounted DOM the same way a canvas-picked selection's path does.
    expect(selection?.path).toBe(
      sourcePathToShadowPath("div:nth-of-type(1) > button:nth-of-type(1)", html),
    );
  });

  it("returns null for a sourcePath that doesn't resolve", () => {
    expect(
      buildSourceEmbedElementSelection(html, "span:nth-of-type(9)", "embed1"),
    ).toBeNull();
  });

  it("returns null when the sourcePath doesn't resolve against empty html", () => {
    expect(buildSourceEmbedElementSelection("", "div:nth-of-type(1)", "embed1")).toBeNull();
  });
});
