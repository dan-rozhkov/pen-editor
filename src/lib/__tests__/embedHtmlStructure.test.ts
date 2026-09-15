import { describe, it, expect } from "vitest";
import {
  moveEmbedElement,
  removeEmbedElement,
  setEmbedElementHidden,
  setEmbedElementName,
} from "../embedHtmlStructure";

// NOTE on shadow paths below, matching embedElementStyle.test.ts: the mount
// container `<div>` always shows up as the leading "div:nth-of-type(1)"
// segment and corresponds to the source html's own `<body>`, so a source
// html with a top-level element (not wrapped in another `<div>`) means the
// container's only child is that element directly.

describe("setEmbedElementName", () => {
  it("sets data-layer-name", () => {
    const html = `<p>hi</p>`;
    const result = setEmbedElementName(html, "div:nth-of-type(1) > p:nth-of-type(1)", "Headline");
    expect(result).not.toBeNull();
    expect(result).toContain('data-layer-name="Headline"');
  });

  it("removes the attribute for an empty name", () => {
    const html = `<p data-layer-name="Old">hi</p>`;
    const result = setEmbedElementName(html, "div:nth-of-type(1) > p:nth-of-type(1)", "");
    expect(result).not.toBeNull();
    expect(result).not.toContain("data-layer-name");
  });

  it("removes the attribute for a whitespace-only name", () => {
    const html = `<p data-layer-name="Old">hi</p>`;
    const result = setEmbedElementName(html, "div:nth-of-type(1) > p:nth-of-type(1)", "   ");
    expect(result).not.toContain("data-layer-name");
  });

  it("trims the name before writing it", () => {
    const html = `<p>hi</p>`;
    const result = setEmbedElementName(html, "div:nth-of-type(1) > p:nth-of-type(1)", "  Headline  ");
    expect(result).toContain('data-layer-name="Headline"');
  });

  it("returns null and does not mutate for an unresolvable path", () => {
    const html = `<div><p>hi</p></div>`;
    const result = setEmbedElementName(html, "div:nth-of-type(1) > span:nth-of-type(1)", "X");
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>hi</p></div>`);
  });

  it("returns null for '' (the source <body> itself)", () => {
    const html = `<p>hi</p>`;
    expect(setEmbedElementName(html, "div:nth-of-type(1)", "X")).toBeNull();
  });

  it("returns null for a malformed path", () => {
    expect(setEmbedElementName(`<p>hi</p>`, "garbage", "X")).toBeNull();
  });

  it("returns null when the name is already set (no-op)", () => {
    const html = `<p data-layer-name="Headline">hi</p>`;
    expect(
      setEmbedElementName(html, "div:nth-of-type(1) > p:nth-of-type(1)", "Headline"),
    ).toBeNull();
  });

  it("returns null when clearing an already-unnamed element (no-op)", () => {
    const html = `<p>hi</p>`;
    expect(setEmbedElementName(html, "div:nth-of-type(1) > p:nth-of-type(1)", "")).toBeNull();
  });

  describe("preserves document shape", () => {
    it("keeps a full <html> document shape, including a leading doctype", () => {
      const html = `<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>`;
      const result = setEmbedElementName(
        html,
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
        "Headline",
      );
      expect(result!.toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(result).toContain("<html");
      expect(result).toContain("<title>T</title>");
      expect(result).toContain('data-layer-name="Headline"');
    });

    it("keeps a body-only fragment shape (no <html> wrapper)", () => {
      const html = `<head><style>body{margin:0}</style></head><body><p>hi</p></body>`;
      const result = setEmbedElementName(
        html,
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
        "Headline",
      );
      expect(result).not.toContain("<html");
      expect(result).toContain("<head>");
      expect(result).toContain("<body");
      expect(result).toContain('data-layer-name="Headline"');
    });

    it("keeps a bare content-fragment shape (no <body> tag at all)", () => {
      const html = `<div class="card"><p>hi</p></div>`;
      const result = setEmbedElementName(
        html,
        "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
        "Headline",
      );
      expect(result).not.toContain("<html");
      expect(result).not.toContain("<body");
      expect(result).toContain('<div class="card">');
      expect(result).toContain('data-layer-name="Headline"');
    });
  });
});

describe("setEmbedElementHidden", () => {
  it("hides a visible element with inline display:none", () => {
    const html = `<p>hi</p>`;
    const result = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
    expect(result).toBe(`<p style="display: none !important;">hi</p>`);
  });

  // Regression for the third-round review: the `!important` carry-forward
  // used to fire only when the author had ALREADY written an inline
  // `display`, which is the one shape where the bug it names cannot occur.
  // The common shape is a stylesheet rule with `!important` and no inline
  // style at all — hiding has to beat that too.
  it("hides with !important even when there was no inline display to stash", () => {
    const html = `<p class="row">hi</p>`;
    const result = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
    expect(result).toMatch(/display:\s*none\s*!important/);
  });

  it("leaves no display declaration behind after a hide/show round trip", () => {
    const html = `<p class="row">hi</p>`;
    const hidden = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
    expect(hidden).not.toBeNull();
    const shown = setEmbedElementHidden(hidden as string, "div:nth-of-type(1) > p:nth-of-type(1)", false);
    expect(shown).toBe(html);
  });

  it("returns null and does not mutate for an unresolvable path", () => {
    const html = `<div><p>hi</p></div>`;
    const result = setEmbedElementHidden(
      html,
      "div:nth-of-type(1) > span:nth-of-type(1)",
      true,
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>hi</p></div>`);
  });

  it("returns null for '' (the source <body> itself)", () => {
    const html = `<p>hi</p>`;
    expect(setEmbedElementHidden(html, "div:nth-of-type(1)", true)).toBeNull();
  });

  it("returns null when hiding an already-hidden element (no-op)", () => {
    const html = `<p style="display: none;">hi</p>`;
    expect(
      setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true),
    ).toBeNull();
  });

  it("returns null when showing an already-visible element (no-op)", () => {
    const html = `<p>hi</p>`;
    expect(
      setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", false),
    ).toBeNull();
  });

  describe("hide/show round trip", () => {
    it("is byte-identical when there was no pre-existing inline style at all", () => {
      const html = `<p>hi</p>`;
      const hidden = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
      expect(hidden).not.toBeNull();
      const shown = setEmbedElementHidden(hidden!, "div:nth-of-type(1) > p:nth-of-type(1)", false);
      expect(shown).toBe(html);
    });

    it("is byte-identical when there was a pre-existing inline style with no display", () => {
      const html = `<p style="color: red;">hi</p>`;
      const hidden = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
      expect(hidden).not.toBeNull();
      expect(hidden).not.toContain("data-pen-display");
      const shown = setEmbedElementHidden(hidden!, "div:nth-of-type(1) > p:nth-of-type(1)", false);
      expect(shown).toBe(html);
    });

    it("stashes and restores a pre-existing inline display value, byte-identical round trip", () => {
      const html = `<p style="display: flex; color: red;">hi</p>`;
      const hidden = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
      expect(hidden).not.toBeNull();
      expect(hidden).toContain('data-pen-display="flex"');
      expect(hidden).toContain("display: none");
      const shown = setEmbedElementHidden(hidden!, "div:nth-of-type(1) > p:nth-of-type(1)", false);
      expect(shown).toBe(html);
      expect(shown).not.toContain("data-pen-display");
    });

    // Regression for finding #7: `.style.display` alone never exposes
    // `!important` (`getPropertyPriority` is a separate accessor), so a
    // naive stash/restore silently drops the priority — a class rule that
    // also sets `display` would then start winning after one hide/show,
    // even though nothing about the author's own inline style changed.
    it("preserves an !important priority on the pre-existing inline display value across the round trip", () => {
      const html = `<p style="display: flex !important; color: red;">hi</p>`;
      const hidden = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
      expect(hidden).not.toBeNull();
      expect(hidden).toContain("display: none");
      const shown = setEmbedElementHidden(hidden!, "div:nth-of-type(1) > p:nth-of-type(1)", false);
      expect(shown).toBe(html);
      expect(shown).toContain("!important");
    });

    // Regression for finding #7 (second round): the HIDE half wrote
    // `display: none` with NO priority, even when the value it replaced had
    // `!important`. An element authored with `display: flex !important` is
    // almost certainly fighting an `!important` stylesheet rule — hiding it
    // without also carrying `!important` onto `none` lets that rule win
    // again, so the element stays visible on canvas while its layers row
    // dims and the eye toggle looks like a no-op.
    it("carries the stashed !important priority onto display: none itself, not just on restore", () => {
      const html = `<p style="display: flex !important; color: red;">hi</p>`;
      const hidden = setEmbedElementHidden(html, "div:nth-of-type(1) > p:nth-of-type(1)", true);
      expect(hidden).not.toBeNull();
      expect(hidden).toMatch(/display:\s*none\s*!important/);
    });
  });

  describe("preserves document shape", () => {
    it("keeps a full <html> document shape", () => {
      const html = `<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>`;
      const result = setEmbedElementHidden(
        html,
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
        true,
      );
      expect(result!.toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(result).toContain("<html");
      expect(result).toContain("display: none");
    });

    it("keeps a body-only fragment shape", () => {
      const html = `<head></head><body><p>hi</p></body>`;
      const result = setEmbedElementHidden(
        html,
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
        true,
      );
      expect(result).not.toContain("<html");
      expect(result).toContain("<body");
      expect(result).toContain("display: none");
    });

    it("keeps a bare content-fragment shape", () => {
      const html = `<div class="card"><p>hi</p></div>`;
      const result = setEmbedElementHidden(
        html,
        "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
        true,
      );
      expect(result).not.toContain("<html");
      expect(result).not.toContain("<body");
      expect(result).toContain("display: none");
    });
  });
});

describe("removeEmbedElement", () => {
  it("removes the element and its subtree", () => {
    const html = `<div><p>one</p><p>two<span>nested</span></p></div>`;
    const result = removeEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
    );
    expect(result).not.toBeNull();
    expect(result).not.toContain("two");
    expect(result).not.toContain("nested");
    expect(result).toContain("<p>one</p>");
  });

  it("returns null and does not mutate for an unresolvable path", () => {
    const html = `<div><p>hi</p></div>`;
    const result = removeEmbedElement(html, "div:nth-of-type(1) > span:nth-of-type(1)");
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>hi</p></div>`);
  });

  it("returns null for '' (the source <body> itself)", () => {
    const html = `<p>hi</p>`;
    expect(removeEmbedElement(html, "div:nth-of-type(1)")).toBeNull();
  });

  it("returns null for a malformed path", () => {
    expect(removeEmbedElement(`<p>hi</p>`, "garbage")).toBeNull();
  });

  describe("preserves document shape", () => {
    it("keeps a full <html> document shape", () => {
      const html = `<!DOCTYPE html><html><head></head><body><p>one</p><p>two</p></body></html>`;
      const result = removeEmbedElement(
        html,
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)",
      );
      expect(result!.toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(result).toContain("<html");
      expect(result).toContain("<p>one</p>");
      expect(result).not.toContain("two");
    });

    it("keeps a bare content-fragment shape", () => {
      const html = `<div class="card"><p>one</p><p>two</p></div>`;
      const result = removeEmbedElement(
        html,
        "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
      );
      expect(result).not.toContain("<html");
      expect(result).not.toContain("<body");
      expect(result).toContain('<div class="card">');
      expect(result).toContain("<p>one</p>");
      expect(result).not.toContain("two");
    });
  });
});

describe("moveEmbedElement", () => {
  it("moves before a sibling", () => {
    const html = `<div><p>one</p><p>two</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "before",
    );
    expect(result).toBe(`<div><p>two</p><p>one</p></div>`);
  });

  it("moves after a sibling", () => {
    const html = `<div><p>one</p><p>two</p><p>three</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(3)",
      "after",
    );
    expect(result).toBe(`<div><p>two</p><p>three</p><p>one</p></div>`);
  });

  it("moves inside a target as its last child", () => {
    const html = `<div><section><p>a</p></section><p>b</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1)",
      "inside",
    );
    expect(result).toBe(`<div><section><p>a</p><p>b</p></section></div>`);
  });

  it("moves across different parents", () => {
    const html = `<div><section><p>a</p></section><aside><p>b</p></aside></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > aside:nth-of-type(1) > p:nth-of-type(1)",
      "after",
    );
    expect(result).toBe(`<div><section></section><aside><p>b</p><p>a</p></aside></div>`);
  });

  it("moves inside the body itself ('' target is legal for inside)", () => {
    const html = `<span>b</span><p>a</p>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > span:nth-of-type(1)",
      "div:nth-of-type(1)",
      "inside",
    );
    expect(result).toBe(`<p>a</p><span>b</span>`);
  });

  it("returns null and does not mutate for an unresolvable source path", () => {
    const html = `<div><p>one</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > span:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "before",
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>one</p></div>`);
  });

  it("returns null and does not mutate for an unresolvable target path", () => {
    const html = `<div><p>one</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1) > span:nth-of-type(1)",
      "before",
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>one</p></div>`);
  });

  it("returns null for '' as the source (never a legal source)", () => {
    const html = `<div><p>one</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "after",
    );
    expect(result).toBeNull();
  });

  it("returns null for '' as a before/after target (body isn't a valid sibling target)", () => {
    const html = `<div><p>one</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1)",
      "before",
    );
    expect(result).toBeNull();
  });

  it("rejects moving an element into itself", () => {
    const html = `<div><p>one</p></div>`;
    const path = "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)";
    const result = moveEmbedElement(html, path, path, "inside");
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>one</p></div>`);
  });

  it("rejects moving an element into its own descendant", () => {
    const html = `<div><section><p>a</p></section></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(1)",
      "before",
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><section><p>a</p></section></div>`);
  });

  it("rejects a move that resolves to the element's current position (before, no-op)", () => {
    const html = `<div><p>one</p><p>two</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
      "before",
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>one</p><p>two</p></div>`);
  });

  it("rejects a move that resolves to the element's current position (after, no-op)", () => {
    const html = `<div><p>one</p><p>two</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "after",
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><p>one</p><p>two</p></div>`);
  });

  it("rejects a move that resolves to the element's current position (inside, already last child)", () => {
    const html = `<div><section><p>a</p><p>b</p></section></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(2)",
      "div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1)",
      "inside",
    );
    expect(result).toBeNull();
    expect(html).toBe(`<div><section><p>a</p><p>b</p></section></div>`);
  });

  // Regression: resolving the target path AFTER performing the source move
  // would renumber siblings and target the wrong element. Move p:nth-of-type(1)
  // to be "after" p:nth-of-type(2) (itself a positional index computed
  // against the ORIGINAL tree) — if the target were re-resolved post-move,
  // "p:nth-of-type(2)" would now point at a different node.
  it("resolves both paths against the pre-mutation tree (ordering trap)", () => {
    const html = `<div><p>a</p><p>b</p><p>c</p></div>`;
    const result = moveEmbedElement(
      html,
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
      "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
      "after",
    );
    expect(result).toBe(`<div><p>b</p><p>a</p><p>c</p></div>`);
  });

  describe("preserves document shape", () => {
    it("keeps a full <html> document shape", () => {
      const html = `<!DOCTYPE html><html><head></head><body><p>one</p><p>two</p></body></html>`;
      const result = moveEmbedElement(
        html,
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(2)",
        "div:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1)",
        "before",
      );
      expect(result!.toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(result).toContain("<html");
      expect(result).toContain("<body");
    });

    it("keeps a bare content-fragment shape", () => {
      const html = `<div class="card"><p>one</p><p>two</p></div>`;
      const result = moveEmbedElement(
        html,
        "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)",
        "div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
        "before",
      );
      expect(result).not.toContain("<html");
      expect(result).not.toContain("<body");
      expect(result).toBe(`<div class="card"><p>two</p><p>one</p></div>`);
    });
  });
});
