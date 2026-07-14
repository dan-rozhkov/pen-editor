import type { H2dDocument } from "@/lib/h2dPaste/h2dTypes";
import captureBundleSource from "@/vendor/h2dCapture/capture.js?raw";

interface H2dCaptureWindow extends Window {
  __h2d_clone?: { en: (selector: string) => Promise<string> };
}

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
  // Close any dangling </script> in the capture source defensively; the
  // embed HTML rides in <body> untouched (it may not contain script tags —
  // embeds are sanitized on mount elsewhere, and the iframe is same-origin
  // but throwaway).
  iframe.srcdoc =
    "<!doctype html><html><head><script>" +
    captureBundleSource.replace(/<\/script>/gi, "<\\/script>") +
    "</script></head><body style=\"margin:0\">" +
    htmlContent +
    "</body></html>";

  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
    });
    const win = iframe.contentWindow as H2dCaptureWindow | null;
    if (!win) throw new Error("h2d capture iframe has no contentWindow");
    await win.document.fonts.ready;
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
