import type { H2dDocument } from "@/lib/h2dPaste/h2dTypes";
import { sanitizeEmbedHtml } from "@/utils/sanitizeEmbedHtml";
import { EMBED_DEFAULT_LINE_HEIGHT } from "@/utils/embedHtmlUtils";
import captureBundleSource from "@/vendor/h2dCapture/capture.js?raw";
import { inlinePhosphorIconSvgs } from "./phosphorIcons";

interface H2dCaptureWindow extends Window {
  __h2d_clone?: { en: (selector: string) => Promise<string> };
}

/** Guard against a `load` event that never fires (e.g. a hung srcdoc parse). */
const IFRAME_LOAD_TIMEOUT_MS = 10_000;

/**
 * Render `htmlContent` in a hidden same-origin iframe at the embed's size and
 * capture it into an h2d document using the vendored html-capture bundle.
 *
 * The iframe (not a shadow root) gives the capture script the real
 * document/viewport it expects, full style isolation, and a working
 * `document.fonts` for the embed's `@import`ed webfonts.
 *
 * NOTE: `requestAnimationFrame` throttles in hidden tabs — same constraint as
 * the old DOM-walk pipeline. Conversion is user-triggered from a visible tab.
 */
export async function captureEmbedHtmlToH2d(
  htmlContent: string,
  width: number,
  height: number,
): Promise<H2dDocument> {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "border:0",
    "visibility:hidden",
    "pointer-events:none",
  ].join(";");
  // Close any dangling </script> in the capture source defensively. The
  // embed body HTML is untrusted (AI output, pasted markup, shared .pen
  // files) and is DOMPurify-sanitized here with the same policy used to
  // mount embeds for rendering (`sanitizeEmbedHtml`) before it rides into
  // <body> — the iframe is same-origin, so unsanitized markup with a
  // <script>/event handler would otherwise execute with direct access to
  // the capture API set up in <head>.
  //
  // No `sandbox` attribute is set, deliberately: the capture bundle needs
  // both script execution and same-origin DOM access, and any sandbox value
  // permissive enough to grant both (`allow-scripts allow-same-origin`) is
  // equivalent to no sandbox at all. DOMPurify sanitization above is the
  // real control here, not the iframe's sandboxing.
  const safeHtmlContent = sanitizeEmbedHtml(htmlContent);
  iframe.srcdoc =
    `<!doctype html><html style="line-height:${EMBED_DEFAULT_LINE_HEIGHT}"><head><script>` +
    captureBundleSource.replace(/<\/script>/gi, "<\\/script>") +
    "</script></head><body style=\"margin:0\">" +
    safeHtmlContent +
    "</body></html>";

  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("h2d capture iframe timed out waiting for load"));
      }, IFRAME_LOAD_TIMEOUT_MS);
      iframe.addEventListener(
        "load",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    const win = iframe.contentWindow as H2dCaptureWindow | null;
    if (!win) throw new Error("h2d capture iframe has no contentWindow");
    await win.document.fonts.ready;
    // Swap Phosphor icon-font glyphs for inline SVGs so the capture emits
    // them as SVG image fills instead of dropping the ::before glyph (which
    // the converter can't render — the icon font doesn't exist on canvas).
    // Icon inlining is strictly best-effort: on failure the icons drop (the
    // pre-inlining behavior) but the conversion itself must proceed.
    try {
      await inlinePhosphorIconSvgs(win.document);
    } catch (error) {
      console.warn("Phosphor icon inlining failed; icons may be missing:", error);
    }
    await new Promise<void>((resolve) =>
      win.requestAnimationFrame(() => resolve()),
    );
    if (!win.__h2d_clone) {
      throw new Error("h2d capture bundle failed to install in iframe");
    }
    const json = await win.__h2d_clone.en("body");
    return JSON.parse(json) as H2dDocument;
  } finally {
    iframe.remove();
  }
}
