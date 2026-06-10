const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i;

function extFromMediaType(mediaType: string | null | undefined): string {
  if (!mediaType) return "png";
  const type = mediaType.split(";")[0].trim().toLowerCase();
  switch (type) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default: {
      const sub = type.split("/")[1];
      return sub ? sub.replace(/\+.*$/, "") : "png";
    }
  }
}

/**
 * Derive a sensible filename from a URL.
 * Uses the last path segment when it already has an image extension,
 * otherwise falls back to `reference-<index>.<ext>`.
 */
export function filenameFromUrl(
  url: string,
  index: number,
  mediaType?: string | null,
): string {
  if (!url.startsWith("data:")) {
    try {
      const { pathname } = new URL(url, "http://localhost");
      const segment = decodeURIComponent(pathname.split("/").pop() ?? "");
      if (segment && IMAGE_EXT_RE.test(segment)) return segment;
    } catch {
      // ignore malformed URLs and fall through to the generated name
    }
  }

  let resolvedMediaType = mediaType;
  if (!resolvedMediaType && url.startsWith("data:")) {
    const match = /^data:([^;,]+)/i.exec(url);
    resolvedMediaType = match?.[1];
  }
  return `reference-${index}.${extFromMediaType(resolvedMediaType)}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerAnchorDownload(objectUrl, filename);
  } finally {
    // Revoke after a tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function triggerAnchorDownload(
  href: string,
  filename: string,
  openInNewTab = false,
): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  if (openInNewTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener";
  }
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  return response.blob();
}

/**
 * Download an image (data: or http(s)) to the user's disk.
 *
 * For `data:` URLs the payload is converted directly to a Blob and saved.
 * For http(s) URLs we try to `fetch` the bytes and save them via an object
 * URL; if that fails (CORS/network) we fall back to a plain anchor download
 * that lets the browser handle the request directly.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  if (url.startsWith("data:")) {
    const blob = await dataUrlToBlob(url);
    saveBlob(blob, filename);
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    saveBlob(blob, filename);
  } catch {
    // CORS or network failure: let the browser attempt the download/open.
    triggerAnchorDownload(url, filename, true);
  }
}
