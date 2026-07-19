import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ensureExternalFontStylesLoaded,
  extractExternalFontStylesheetUrls,
} from "../fontStylesheets";

// happy-dom would perform a real network fetch when a <link rel="stylesheet"> is
// connected, so we disable CSS file loading to keep CI offline. The side effect
// is that happy-dom then fires `error` SYNCHRONOUSLY on every stylesheet append
// — a test-env artifact (a real browser starts an async CDN load, not an
// instant failure). We swallow that one synchronous connect-time error per
// append so links behave as "pending"; tests drive load/error explicitly.
let restoreAppend: (() => void) | undefined;
beforeAll(() => {
  const happyDOM = (globalThis as { happyDOM?: { settings: { disableCSSFileLoading: boolean } } })
    .happyDOM;
  if (happyDOM) happyDOM.settings.disableCSSFileLoading = true;

  const proto = HTMLHeadElement.prototype;
  const orig = proto.appendChild;
  proto.appendChild = function <T extends Node>(this: HTMLHeadElement, node: T): T {
    if (node instanceof HTMLLinkElement) {
      const realDispatch = node.dispatchEvent.bind(node);
      node.dispatchEvent = (event: Event) =>
        event.type === "error" ? true : realDispatch(event);
      try {
        return orig.call(this, node) as T;
      } finally {
        node.dispatchEvent = realDispatch;
      }
    }
    return orig.call(this, node) as T;
  };
  restoreAppend = () => { proto.appendChild = orig; };
});
afterAll(() => restoreAppend?.());

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
  it("finds @import url() with single quotes (unpkg @phosphor-icons allowlisted)", () => {
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

  it("finds @import bare-string form (no url())", () => {
    const html = `<style>@import "https://fonts.googleapis.com/css2?family=Lato";</style>`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://fonts.googleapis.com/css2?family=Lato",
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

  it("rejects unpkg URLs outside the @phosphor-icons package", () => {
    const html = `<link rel="stylesheet" href="https://unpkg.com/bootstrap@5/dist/css/bootstrap.min.css">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([]);
  });

  it("accepts unpkg @phosphor-icons subpaths", () => {
    const html = `<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css",
    ]);
  });

  it("ignores non-stylesheet links (e.g. icon/preconnect)", () => {
    const html = `<link rel="icon" href="https://unpkg.com/favicon.ico"><link rel="preconnect" href="https://fonts.googleapis.com">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([]);
  });

  it("ignores rel=\"alternate stylesheet\" links", () => {
    const html = `<link rel="alternate stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([]);
  });

  it("resolves protocol-relative allowed URLs to absolute https", () => {
    const html = `<link rel="stylesheet" href="//fonts.googleapis.com/css2?family=Inter">`;
    expect(extractExternalFontStylesheetUrls(html)).toEqual([
      "https://fonts.googleapis.com/css2?family=Inter",
    ]);
  });

  it("rejects relative-path stylesheet URLs", () => {
    const html = `<link rel="stylesheet" href="/local/fonts.css">`;
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

  it("hoists a protocol-relative allowed URL as an https link", () => {
    void ensureExternalFontStylesLoaded(
      `<link rel="stylesheet" href="//fonts.googleapis.com/css2?family=Inter">`,
    );
    const links = headFontLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(
      "https://fonts.googleapis.com/css2?family=Inter",
    );
  });

  it("retries with a fresh link after a failed load (no wedge)", async () => {
    const url = "https://fonts.googleapis.com/css2?family=Retry";

    const first = ensureExternalFontStylesLoaded(`<link rel="stylesheet" href="${url}">`);
    const firstLinks = headFontLinks();
    expect(firstLinks).toHaveLength(1);

    // Simulate a load failure: the broken link must be removed and the promise
    // must settle rather than wedge the dedupe map.
    firstLinks[0].dispatchEvent(new Event("error"));
    await first;
    expect(headFontLinks()).toHaveLength(0);

    // A later request retries with a brand-new link instead of re-attaching to
    // the removed one.
    const second = ensureExternalFontStylesLoaded(`<link rel="stylesheet" href="${url}">`);
    const secondLinks = headFontLinks();
    expect(secondLinks).toHaveLength(1);
    secondLinks[0].dispatchEvent(new Event("load"));
    await second;
  });
});
