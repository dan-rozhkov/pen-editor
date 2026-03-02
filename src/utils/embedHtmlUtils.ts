/**
 * Shared utilities for mounting HTML with body-targeted styles into containers.
 * Used by InlineEmbedEditor, htmlToDesignNodes, and htmlTextureHelpers.
 */

/** Detect whether HTML contains `<body>` tags or CSS selectors targeting `html`/`body`. */
export function hasBodyTargetedStyles(html: string): boolean {
  if (/<body[\s>]/i.test(html)) return true;
  return /(^|[^\w-])(html|body)\s*(,|\{)/im.test(html);
}

export interface MountResult {
  root: HTMLElement;
  wrappedBody: boolean;
  originalHasBodyTag: boolean;
}

/**
 * Mount HTML into a container, creating a synthetic `<body>` element when the
 * HTML contains body-targeted styles. Returns the effective root for content
 * operations and metadata about the mounting.
 */
export function mountHtmlWithBodyStyles(
  container: HTMLElement,
  html: string,
  width: number,
  height: number,
): MountResult {
  const originalHasBodyTag = /<body[\s>]/i.test(html);
  if (!hasBodyTargetedStyles(html)) {
    container.innerHTML = html;
    return { root: container, wrappedBody: false, originalHasBodyTag: false };
  }

  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");

    for (const node of Array.from(parsed.head.childNodes)) {
      container.appendChild(document.importNode(node, true));
    }

    const body = document.createElement("body");
    body.style.cssText = `
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      margin: 0;
      padding: 0;
    `;
    if (parsed.body.className) body.className = parsed.body.className;
    const parsedBodyStyle = parsed.body.getAttribute("style");
    if (parsedBodyStyle) body.style.cssText += `;${parsedBodyStyle}`;
    body.innerHTML = parsed.body.innerHTML;
    container.appendChild(body);

    return { root: body, wrappedBody: true, originalHasBodyTag };
  } catch {
    container.innerHTML = html;
    return { root: container, wrappedBody: false, originalHasBodyTag };
  }
}
