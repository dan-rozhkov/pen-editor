import { afterEach, describe, expect, it, vi } from "vitest";
import { materializePseudoElements } from "@/utils/pseudoElementMaterializer";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("materializePseudoElements", () => {
  it("suppresses the source pseudo-element after copying its glyph", () => {
    const root = document.createElement("div");
    const icon = document.createElement("i");
    root.append(icon);

    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (element === icon && pseudo === "::before") {
        const style = realGetComputedStyle(icon);
        return new Proxy(style, {
          get: (target, property) =>
            property === "content" ? '"\\e2c2"' : Reflect.get(target, property),
        });
      }
      if (element === icon && pseudo === "::after") {
        const style = realGetComputedStyle(icon);
        return new Proxy(style, {
          get: (target, property) =>
            property === "content" ? "none" : Reflect.get(target, property),
        });
      }
      return realGetComputedStyle(element as Element, pseudo);
    });

    materializePseudoElements(root);

    expect(icon.dataset.embedMaterializedBefore).toBe("true");
    expect(icon.querySelector('[data-embed-pseudo="before"]')?.textContent).toBe(
      "\ue2c2",
    );
    expect(
      root.querySelector("style[data-embed-pseudo-suppression]")?.textContent,
    ).toContain('[data-embed-materialized-before="true"]::before');
  });
});
