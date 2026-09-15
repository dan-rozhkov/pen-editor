import { describe, it, expect } from "vitest";
import { isTextLeaf, SKIP_TAGS } from "../embedTextLeaf";

function makeRoot(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("embedTextLeaf", () => {
  describe("isTextLeaf", () => {
    it("is true for an element with only direct text content", () => {
      const root = makeRoot(`<button>Buy now</button>`);
      expect(isTextLeaf(root.querySelector("button")!)).toBe(true);
    });

    it("is true for a text leaf with only whitespace-only element children", () => {
      const root = makeRoot(`<h1>Title <span></span></h1>`);
      expect(isTextLeaf(root.querySelector("h1")!)).toBe(true);
    });

    it("is false for a container whose child elements carry the actual text", () => {
      const root = makeRoot(`<div><p>one</p><p>two</p></div>`);
      expect(isTextLeaf(root.querySelector("div")!)).toBe(false);
    });

    it("is false for an element with no non-whitespace text", () => {
      const root = makeRoot(`<div>   </div>`);
      expect(isTextLeaf(root.querySelector("div")!)).toBe(false);
    });

    it("is false for an element with no text at all", () => {
      const root = makeRoot(`<div></div>`);
      expect(isTextLeaf(root.querySelector("div")!)).toBe(false);
    });

    for (const tag of ["style", "script", "svg", "img", "input", "textarea", "select", "br", "hr"]) {
      it(`is false for a skip-listed <${tag}> even with text content`, () => {
        const root = makeRoot(`<div></div>`);
        const el = document.createElement(tag);
        // Force text content in even for void tags — the point is the tag
        // check short-circuits before text is ever inspected.
        try {
          el.textContent = "hello";
        } catch {
          // some void elements don't accept textContent assignment in every
          // engine; irrelevant to what's being tested here.
        }
        root.querySelector("div")!.appendChild(el);
        expect(isTextLeaf(el)).toBe(false);
        expect(SKIP_TAGS.has(el.tagName)).toBe(true);
      });
    }

    it("ignores a skip-tagged child when deciding if a parent is still a text leaf", () => {
      // A <div>Caption<img></div> should still read as a text leaf: the
      // <img> carries no text of its own to compete with the div's text.
      const root = makeRoot(`<div>Caption<img /></div>`);
      expect(isTextLeaf(root.querySelector("div")!)).toBe(true);
    });
  });
});
