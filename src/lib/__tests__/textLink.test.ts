import { describe, it, expect } from "vitest";
import { isSafeLinkHref, parseMarkdownLink, TEXT_LINK_COLOR } from "../textLink";

describe("parseMarkdownLink", () => {
  it("parses a plain markdown link", () => {
    expect(parseMarkdownLink("[Sign up now](https://example.com/signup)")).toEqual({
      text: "Sign up now",
      url: "https://example.com/signup",
    });
  });

  it("parses a markdown link with a title", () => {
    expect(
      parseMarkdownLink('[Docs](https://example.com/docs "Read the docs")'),
    ).toEqual({
      text: "Docs",
      url: "https://example.com/docs",
      title: "Read the docs",
    });
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseMarkdownLink("  [Home](https://example.com)  ")).toEqual({
      text: "Home",
      url: "https://example.com",
    });
  });

  it("returns null for plain text", () => {
    expect(parseMarkdownLink("Just some text")).toBeNull();
  });

  it("returns null when the markdown link is only part of the content", () => {
    expect(parseMarkdownLink("See [Docs](https://example.com) for more")).toBeNull();
  });

  it("returns null for malformed markdown link syntax", () => {
    expect(parseMarkdownLink("[Docs](")).toBeNull();
    expect(parseMarkdownLink("[Docs]")).toBeNull();
    expect(parseMarkdownLink("(https://example.com)")).toBeNull();
  });
});

describe("isSafeLinkHref", () => {
  it("allows http/https/mailto/tel schemes", () => {
    expect(isSafeLinkHref("https://example.com")).toBe(true);
    expect(isSafeLinkHref("http://example.com")).toBe(true);
    expect(isSafeLinkHref("mailto:a@b.com")).toBe(true);
    expect(isSafeLinkHref("tel:+15551234")).toBe(true);
  });

  it("allows relative / anchor / scheme-less URLs", () => {
    expect(isSafeLinkHref("/path")).toBe(true);
    expect(isSafeLinkHref("#section")).toBe(true);
    expect(isSafeLinkHref("?q=1")).toBe(true);
    expect(isSafeLinkHref("example.com/path")).toBe(true);
  });

  it("rejects dangerous schemes and empty input", () => {
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("data:text/html,<script>1</script>")).toBe(false);
    expect(isSafeLinkHref("vbscript:msgbox")).toBe(false);
    expect(isSafeLinkHref("   ")).toBe(false);
  });
});

describe("TEXT_LINK_COLOR", () => {
  it("is the app's accent blue", () => {
    expect(TEXT_LINK_COLOR).toBe("#0d99ff");
  });
});
