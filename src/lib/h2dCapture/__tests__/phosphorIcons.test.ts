import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inlinePhosphorIconSvgs,
  parsePhosphorIconClasses,
  phosphorSvgUrl,
} from "../phosphorIcons";

afterEach(() => {
  vi.restoreAllMocks();
});

const HOUSE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M219 108l-80-80"/></svg>';

function makeDoc(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = bodyHtml;
  return doc;
}

describe("parsePhosphorIconClasses", () => {
  it("parses the regular-weight `ph ph-<name>` class pair", () => {
    expect(parsePhosphorIconClasses(["ph", "ph-house"])).toEqual({
      name: "house",
      weight: "regular",
    });
  });

  it("parses non-regular weights like ph-fill", () => {
    expect(parsePhosphorIconClasses(["ph-fill", "ph-heart"])).toEqual({
      name: "heart",
      weight: "fill",
    });
  });

  it("returns null without a weight class", () => {
    expect(parsePhosphorIconClasses(["ph-heart"])).toBeNull();
  });

  it("returns null without an icon-name class", () => {
    expect(parsePhosphorIconClasses(["ph"])).toBeNull();
    expect(parsePhosphorIconClasses(["btn", "primary"])).toBeNull();
  });

  it("rejects icon names with characters outside [a-z0-9-]", () => {
    expect(parsePhosphorIconClasses(["ph", "ph-../evil"])).toBeNull();
  });
});

describe("phosphorSvgUrl", () => {
  it("builds the regular-weight core asset URL without a suffix", () => {
    expect(phosphorSvgUrl({ name: "house", weight: "regular" })).toBe(
      "https://unpkg.com/@phosphor-icons/core@2.1.1/assets/regular/house.svg",
    );
  });

  it("suffixes non-regular weights", () => {
    expect(phosphorSvgUrl({ name: "heart", weight: "fill" })).toBe(
      "https://unpkg.com/@phosphor-icons/core@2.1.1/assets/fill/heart-fill.svg",
    );
  });
});

describe("inlinePhosphorIconSvgs", () => {
  it("replaces a phosphor icon element's glyph with an inline svg", async () => {
    const doc = makeDoc(
      '<i class="ph ph-house" style="font-size: 24px; color: rgb(255, 0, 0)"></i>',
    );
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    expect(fetchSvgText).toHaveBeenCalledWith(
      "https://unpkg.com/@phosphor-icons/core@2.1.1/assets/regular/house.svg",
    );
    const icon = doc.querySelector("i")!;
    const svg = icon.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.getAttribute("fill")).toBe("rgb(255, 0, 0)");
    // The font glyph must be suppressed so it isn't double-captured.
    expect(icon.hasAttribute("data-ph-svg-icon")).toBe(true);
    expect(doc.head.textContent).toContain("[data-ph-svg-icon]::before");
  });

  it("fetches each distinct icon URL once", async () => {
    const doc = makeDoc(
      '<i class="ph ph-house"></i><i class="ph ph-house"></i>',
    );
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    expect(fetchSvgText).toHaveBeenCalledTimes(1);
    expect(doc.querySelectorAll("svg")).toHaveLength(2);
  });

  it("leaves the element untouched when the fetch fails", async () => {
    const doc = makeDoc('<i class="ph ph-house"></i>');
    const fetchSvgText = vi.fn(async () => null);

    await expect(
      inlinePhosphorIconSvgs(doc, fetchSvgText),
    ).resolves.not.toThrow();

    const icon = doc.querySelector("i")!;
    expect(icon.querySelector("svg")).toBeNull();
    expect(icon.hasAttribute("data-ph-svg-icon")).toBe(false);
  });

  it("ignores elements without phosphor icon classes", async () => {
    const doc = makeDoc('<div class="phone">hi</div><i class="ph"></i>');
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    expect(fetchSvgText).not.toHaveBeenCalled();
    expect(doc.querySelector("svg")).toBeNull();
  });

  it("falls back to a 16px box when font-size is not resolvable", async () => {
    const doc = makeDoc('<i class="ph ph-house"></i>');
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    const svg = doc.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
  });

  it("skips icons hidden with font-size: 0 instead of forcing a visible box", async () => {
    const doc = makeDoc('<i class="ph ph-house" style="font-size: 0px"></i>');
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    expect(doc.querySelector("svg")).toBeNull();
    expect(doc.querySelector("i")!.hasAttribute("data-ph-svg-icon")).toBe(false);
  });

  it("suppresses the ::after glyph layer too (duotone icons)", async () => {
    const doc = makeDoc('<i class="ph-duotone ph-house"></i>');
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    expect(fetchSvgText).toHaveBeenCalledWith(
      "https://unpkg.com/@phosphor-icons/core@2.1.1/assets/duotone/house-duotone.svg",
    );
    expect(doc.head.textContent).toContain("[data-ph-svg-icon]::before");
    expect(doc.head.textContent).toContain("[data-ph-svg-icon]::after");
  });

  it("treats an empty fetched body as a failure and leaves the element untouched", async () => {
    const doc = makeDoc('<i class="ph ph-house"></i>');
    const fetchSvgText = vi.fn(async () => "");

    await inlinePhosphorIconSvgs(doc, fetchSvgText);

    const icon = doc.querySelector("i")!;
    expect(icon.querySelector("svg")).toBeNull();
    expect(icon.hasAttribute("data-ph-svg-icon")).toBe(false);
  });

  it("isolates a throwing icon so the rest still convert and nothing rejects", async () => {
    const doc = makeDoc(
      '<i id="bad" class="ph ph-house"></i><i id="good" class="ph ph-heart"></i>',
    );
    const fetchSvgText = vi.fn(async () => HOUSE_SVG);
    const badEl = doc.getElementById("bad")!;
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      if (el === badEl) throw new Error("boom");
      return realGetComputedStyle(el as Element, pseudo);
    });

    await expect(
      inlinePhosphorIconSvgs(doc, fetchSvgText),
    ).resolves.not.toThrow();

    expect(doc.getElementById("bad")!.querySelector("svg")).toBeNull();
    expect(doc.getElementById("good")!.querySelector("svg")).not.toBeNull();
  });
});
