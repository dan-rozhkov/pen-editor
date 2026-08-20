// Shared plumbing for the image-ops core (removeBackground.ts, vectorize.ts):
// finding the image paint a node-scoped operation should act on, and turning
// whatever URL that paint carries into one the backend can actually fetch.
//
// `blob:`/`data:` URLs never leave the browser tab — a `blob:` url is only
// valid inside the tab that created it, and a `data:` url can be megabytes
// of inline base64 that no backend endpoint here accepts as `image_url`. A
// node whose image was just dropped/pasted onto the canvas holds one of
// these (see `readBlobAsDataURL` in `src/components/canvas/imageImport.ts` —
// local uploads land as `data:` URLs, never `blob:`, but both are handled
// here defensively). Without this upload step, remove-background/vectorize
// would silently fail on exactly the images a user is most likely to try
// them on first.
import { useSceneStore } from "@/store/sceneStore";
import { getFills, clearLegacyFillProps } from "@/utils/fillUtils";
import type { ImagePaint } from "@/types/scene";
import { resolveApiUrl, isOffline } from "@/lib/apiBase";

/** The first image paint on a node's fill stack, or a descriptive error. */
export function findNodeImagePaint(nodeId: string): ImagePaint {
  const node = useSceneStore.getState().nodesById[nodeId];
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  const imagePaint = getFills(node).find(
    (paint): paint is ImagePaint => paint.type === "image",
  );
  if (!imagePaint) {
    throw new Error(`Node ${nodeId} has no image fill to operate on.`);
  }
  return imagePaint;
}

function blobUrlToDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to read the local image."));
          reader.readAsDataURL(blob);
        }),
    );
}

async function uploadDataUrl(dataUrl: string): Promise<string> {
  if (isOffline()) {
    throw new Error("Offline: uploading the image requires a network connection.");
  }
  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/upload-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
  } catch {
    throw new Error("Failed to reach the backend to upload the image.");
  }
  if (!res.ok) {
    if (res.status === 503) {
      throw new Error("Image upload is not configured on this backend (no S3 storage).");
    }
    throw new Error(`Image upload failed (${res.status})`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    throw new Error("Image upload returned no url");
  }
  return data.url;
}

/**
 * Guarantee a URL the backend can fetch: uploads `blob:`/`data:` sources to
 * get a public url first, passes anything else (http/https) through as-is.
 */
export async function ensurePublicUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return uploadDataUrl(url);
  }
  if (url.startsWith("blob:")) {
    return uploadDataUrl(await blobUrlToDataUrl(url));
  }
  return url;
}

/** A node's image-fill url, uploaded to a public url first if needed. */
export async function resolveNodeImageUrl(nodeId: string): Promise<string> {
  const paint = findNodeImagePaint(nodeId);
  return ensurePublicUrl(paint.image.url);
}

/**
 * Write a new url onto a specific image paint layer, preserving every other
 * field of that paint's `ImageFill` (`mode`, `crop`, `adjustments`) as well
 * as every other paint in the stack. Re-reads the node fresh right before
 * writing (an operation may have been in flight across a network round
 * trip), and errors rather than silently no-op-ing if the paint is gone.
 */
export function applyImagePaintUrl(nodeId: string, paintId: string, newUrl: string): void {
  const node = useSceneStore.getState().nodesById[nodeId];
  if (!node) {
    throw new Error(`Node ${nodeId} was deleted before the operation completed.`);
  }
  const fills = getFills(node);
  if (!fills.some((paint) => paint.id === paintId)) {
    throw new Error(`Node ${nodeId}'s image fill changed before the operation completed.`);
  }
  const newFills = fills.map((paint) =>
    paint.id === paintId && paint.type === "image"
      ? { ...paint, image: { ...paint.image, url: newUrl } }
      : paint,
  );
  useSceneStore.getState().updateNode(nodeId, {
    fills: newFills,
    ...clearLegacyFillProps(),
  });
}
