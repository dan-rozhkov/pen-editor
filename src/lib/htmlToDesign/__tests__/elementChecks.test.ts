import { describe, it, expect, afterEach } from "vitest";
import { hasVisualStyling } from "../elementChecks";

function styleFor(el: HTMLElement, css: Record<string, string>): CSSStyleDeclaration {
  Object.assign(el.style, css);
  document.body.appendChild(el);
  return window.getComputedStyle(el);
}

describe("hasVisualStyling: backgroundImage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("treats a gradient backgroundImage as visual styling", () => {
    const el = document.createElement("div");
    const style = styleFor(el, {
      backgroundImage: "linear-gradient(180deg, #fde68a 0%, #fbbf24 100%)",
    });
    expect(hasVisualStyling(style)).toBe(true);
  });

  it("returns false when backgroundImage is none and nothing else is styled", () => {
    const el = document.createElement("div");
    const style = styleFor(el, { backgroundImage: "none" });
    expect(hasVisualStyling(style)).toBe(false);
  });
});
