import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `captureEmbedHtmlToH2d` renders `htmlContent` into a same-origin iframe's
 * `srcdoc`. happy-dom cannot execute `srcdoc` (no real navigation/`load`
 * firing — see the module docstring), so the iframe's capture output can't
 * be exercised here; that's e2e/real-browser territory. What unit tests
 * *can* pin is the security-relevant seam: the embed HTML must be routed
 * through `sanitizeEmbedHtml` (the same helper the live embed-mount pipeline
 * uses, see `embedHtmlUtils.ts`) before it is concatenated into the iframe
 * markup, and the vendored capture bundle in <head> must survive untouched.
 *
 * `sanitizeEmbedHtml`'s own DOMPurify tag-stripping is not re-verified here
 * for the same happy-dom reason documented in `sanitizeEmbedHtml.test.ts`.
 */
const SANITIZED_MARKER = "__SANITIZED_OUTPUT_MARKER__";

vi.mock("@/utils/sanitizeEmbedHtml", () => ({
  sanitizeEmbedHtml: vi.fn(() => SANITIZED_MARKER),
}));

import { sanitizeEmbedHtml } from "@/utils/sanitizeEmbedHtml";
import { captureEmbedHtmlToH2d } from "../captureEmbed";

const sanitizeEmbedHtmlMock = vi.mocked(sanitizeEmbedHtml);

describe("captureEmbedHtmlToH2d", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    sanitizeEmbedHtmlMock.mockClear();
  });

  it("sanitizes htmlContent before writing it into the iframe srcdoc", () => {
    const malicious = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    // Fire-and-forget: the iframe never fires `load` under happy-dom, so the
    // returned promise stays pending. Only the synchronous setup (iframe
    // creation, srcdoc assignment, appendChild) runs before the first await.
    void captureEmbedHtmlToH2d(malicious, 100, 100).catch(() => {});

    expect(sanitizeEmbedHtmlMock).toHaveBeenCalledWith(malicious);

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.srcdoc;
    expect(srcdoc).toContain(SANITIZED_MARKER);
    expect(srcdoc).not.toContain(malicious);
    expect(srcdoc).not.toContain('onerror="alert(1)"');
    expect(srcdoc).not.toContain("<script>alert(2)</script>");
  });

  it("still injects the vendored capture bundle into <head>, unsanitized", () => {
    void captureEmbedHtmlToH2d("<p>hi</p>", 50, 50).catch(() => {});

    const iframe = document.querySelector("iframe");
    const srcdoc = iframe!.srcdoc;
    expect(srcdoc).toMatch(/^<!doctype html><html><head><script>/);
    expect(srcdoc).toContain("__h2d_clone");
    expect(srcdoc).toContain(`<body style="margin:0">${SANITIZED_MARKER}</body>`);
  });
});
