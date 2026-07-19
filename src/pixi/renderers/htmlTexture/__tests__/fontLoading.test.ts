import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ensureExternalFontStylesLoaded,
  extractExternalFontStylesheetUrls,
} from "../fontLoading";

// happy-dom performs a real network fetch when a <link rel="stylesheet"> is
// connected to the document — disable that so hoisting <link> elements to
// document.head never hits the network in CI.
beforeAll(() => {
  const happyDOM = (globalThis as { happyDOM?: { settings: { disableCSSFileLoading: boolean } } })
    .happyDOM;
  if (happyDOM) happyDOM.settings.disableCSSFileLoading = true;
});

function headFontLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>("link[data-embed-font-url]"),
  );
}

afterEach(() => {
  // Resolve pending promises (clears the module dedupe map) and detach links.
  for (const link of headFontLinks()) {
    link.dispatchEvent(new Event("load"));
    link.remove();
  }
});

describe("extractExternalFontStylesheetUrls", () => {
  it("finds @import url() with single quotes (unpkg allowlisted)", () => {
    const html = `<style>@import url('https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css');</style>`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css",
    ]);
  });

  it("finds @import url() with double quotes (google fonts allowlisted)", () => {
    const html = `<style>@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&display=swap");</style>`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&display=swap",
    ]);
  });

  it("finds @import url() without quotes", () => {
    const html = `<style>@import url(https://fonts.googleapis.com/css?family=Roboto);</style>`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://fonts.googleapis.com/css?family=Roboto",
    ]);
  });

  it("finds <link rel=\"stylesheet\"> hrefs", () => {
    const html = `<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css",
    ]);
  });

  it("finds <link> hrefs regardless of attribute order", () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://fonts.googleapis.com/css2?family=Inter",
    ]);
  });

  it("ignores non-allowlisted hosts", () => {
    const html = `<style>@import url('https://evil.example/style.css');</style><link rel="stylesheet" href="https://cdn.attacker.test/x.css">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([]);
  });

  it("ignores non-stylesheet links (e.g. icon/preconnect)", () => {
    const html = `<link rel="icon" href="https://unpkg.com/favicon.ico"><link rel="preconnect" href="https://fonts.googleapis.com">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([]);
  });

  it("dedupes repeated URLs", () => {
    const url = "https://fonts.googleapis.com/css2?family=Outfit";
    const html = `<style>@import url('${url}');</style><link rel="stylesheet" href="${url}">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([url]);
  });
});

describe("ensureExternalFontStylesLoaded (document-level hoisting)", () => {
  it("appends exactly one document.head link for an allowlisted @import", () => {
    const url = "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css";
    void ensureExternalFontStylesLoaded(`<style>@import url('${url}');</style>`);
    const links = headFontLinks();
    expect(links).toHaveLength(1);
    expect(links[0].href).toContain("unpkg.com/@phosphor-icons");
    expect(links[0].rel).toBe("stylesheet");
  });

  it("does not duplicate the link when a second embed uses the same URL", () => {
    const url = "https://fonts.googleapis.com/css2?family=Outfit:wght@400;700";
    void ensureExternalFontStylesLoaded(`<style>@import url('${url}');</style>`);
    void ensureExternalFontStylesLoaded(`<link rel="stylesheet" href="${url}">`);
    expect(headFontLinks()).toHaveLength(1);
  });

  it("does not append a link for a non-allowlisted URL", () => {
    void ensureExternalFontStylesLoaded(
      `<style>@import url('https://evil.example/all.css');</style>`,
    );
    expect(headFontLinks()).toHaveLength(0);
  });
});
