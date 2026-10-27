import { toast } from "sonner";
import { extFromMediaType, saveBlob } from "@/lib/downloadFile";

export type ImageOpenDecision =
  | { kind: "open"; url: string }
  | { kind: "download"; url: string }
  | { kind: "none" };

export const IMAGE_DOWNLOAD_FAILED_MESSAGE = "Could not download the image.";

/**
 * What the button on a document image does with its `src`. A cross-origin http(s) image opens in
 * a new tab (the desktop shell sends it to the system browser). Everything that would open on the
 * editor's own origin is downloaded instead: as a page, a `data:text/html`, a scripted SVG or a
 * same-origin file would run with access to the editor's storage (and the desktop shell denies
 * same-origin windows anyway).
 */
export function decideImageOpen(src: string, origin: string): ImageOpenDecision {
  const raw = src.trim();
  if (!raw) return { kind: "none" };
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return { kind: "none" };
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.origin === origin ? { kind: "download", url: url.href } : { kind: "open", url: url.href };
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return { kind: "download", url: url.href };
  return { kind: "none" };
}

/** The decision for `src` on this page. */
export function decideDocImageOpen(src: string): ImageOpenDecision {
  return decideImageOpen(src, window.location.origin);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i;

/** The last path segment when it has an image extension, else `image.<ext>` from the media type. */
export function imageFilename(url: string, mediaType?: string | null): string {
  if (url.startsWith("http:") || url.startsWith("https:")) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
      if (IMAGE_EXT.test(last)) return last;
    } catch {
      // fall through to the generated name
    }
  }
  return `image.${extFromMediaType(mediaType)}`;
}

/** Opens the image in a new tab, or downloads it (see `decideImageOpen`). Never throws. */
export async function openDocImage(src: string): Promise<void> {
  try {
    const decision = decideDocImageOpen(src);
    if (decision.kind === "none") return;
    if (decision.kind === "open") {
      window.open(decision.url, "_blank", "noopener,noreferrer");
      return;
    }
    // Every download source is local or same-origin, so fetch can read it; `fetch` also parses
    // `data:` URLs correctly (a bare `%` in an inline SVG is fine).
    const response = await fetch(decision.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    saveBlob(blob, imageFilename(decision.url, blob.type));
  } catch (e) {
    console.error("open image failed", e);
    toast.error(IMAGE_DOWNLOAD_FAILED_MESSAGE);
  }
}
