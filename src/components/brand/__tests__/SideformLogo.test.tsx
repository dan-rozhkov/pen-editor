import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SideformLockup, SideformMark } from "../SideformLogo";
import { parseLogoSvg } from "../../../../scripts/generate-sideform-logo.mjs";
import { SIDEFORM_MARK_PATH, SIDEFORM_WORDMARK_PATHS } from "../sideformLogoPaths";

const publicDir = resolve(__dirname, "../../../../public");
const brandSvg = (name: string) => parseLogoSvg(readFileSync(resolve(publicDir, "brand", name), "utf8"));

describe("SideformLogo", () => {
  it("draws the outlined lockup: the mark plus nine letter paths, no text or images", () => {
    const { container } = render(<SideformLockup />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 911 217");
    expect(svg?.querySelectorAll("path")).toHaveLength(1 + SIDEFORM_WORDMARK_PATHS.length);
    expect(svg?.querySelector("text, image")).toBeNull();
    const evenOdd = [SIDEFORM_MARK_PATH, ...SIDEFORM_WORDMARK_PATHS].filter((p) => p.evenOdd).length;
    expect(svg?.querySelectorAll('path[fill-rule="evenodd"]')).toHaveLength(evenOdd);
    for (const path of svg?.querySelectorAll("path") ?? []) expect(path.getAttribute("fill")).toBe("currentColor");
  });

  it("draws the mark alone in its own viewBox", () => {
    const { container } = render(<SideformMark />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 157 217");
    expect(svg?.querySelectorAll("path")).toHaveLength(1);
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(SIDEFORM_MARK_PATH.d);
  });

  it("is hidden from screen readers unless it is given a name", () => {
    const hidden = render(<SideformLockup />).container.querySelector("svg");
    expect(hidden?.getAttribute("aria-hidden")).toBe("true");
    expect(hidden?.getAttribute("role")).toBeNull();

    const named = render(<SideformMark label="Sideform" />).container.querySelector("svg");
    expect(named?.getAttribute("role")).toBe("img");
    expect(named?.getAttribute("aria-label")).toBe("Sideform");
    expect(named?.getAttribute("aria-hidden")).toBeNull();
  });
});

describe("logo source", () => {
  it("the generated paths match public/brand/*.svg (rerun scripts/generate-sideform-logo.mjs)", () => {
    const asParsed = (p: typeof SIDEFORM_MARK_PATH) => ({ d: p.d, x: String(p.x), y: String(p.y), evenOdd: p.evenOdd ?? false });
    expect(brandSvg("sideform-lockup.svg")).toEqual([SIDEFORM_MARK_PATH, ...SIDEFORM_WORDMARK_PATHS].map(asParsed));
    expect(brandSvg("sideform-mark.svg")).toEqual([asParsed(SIDEFORM_MARK_PATH)]);
  });

  it("the favicon draws the same mark", () => {
    expect(readFileSync(resolve(publicDir, "favicon.svg"), "utf8")).toContain(`d="${SIDEFORM_MARK_PATH.d}`);
  });
});

describe("site icons", () => {
  it("the manifest names Sideform and every icon it lists exists", () => {
    const manifest = JSON.parse(readFileSync(resolve(publicDir, "manifest.webmanifest"), "utf8")) as {
      name: string;
      short_name: string;
      icons: { src: string }[];
    };
    expect(manifest.name).toBe("Sideform");
    expect(manifest.short_name).toBe("Sideform");
    for (const icon of manifest.icons) expect(readFileSync(resolve(publicDir, icon.src)).byteLength).toBeGreaterThan(0);
  });

  it("index.html links only icon files that exist", () => {
    const html = readFileSync(resolve(publicDir, "../index.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const hrefs = [...doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((l) =>
      (l.getAttribute("href") ?? "").replace(/^\//, ""),
    );
    expect(hrefs.sort()).toEqual(["favicon.ico", "favicon.svg", "icons/apple-touch-icon.png", "manifest.webmanifest"]);
    for (const href of hrefs) expect(readFileSync(resolve(publicDir, href)).byteLength).toBeGreaterThan(0);
  });
});
