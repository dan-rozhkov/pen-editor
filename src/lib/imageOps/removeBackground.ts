// Core of the "remove background" image operation, shared by the agent tool
// (src/lib/tools/removeBackground) and the properties-panel button — see
// CLAUDE.md's split-execution note, which applies here too even though this
// isn't an AI-agent scene-graph tool: whatever calls into the scene must live
// once, not be duplicated between the two entry points.
import { resolveApiUrl, isOffline } from "@/lib/apiBase";
import { applyImagePaintUrl, findNodeImagePaint, resolveNodeImageUrl } from "./resolveSourceUrl";

export interface RemoveBackgroundResult {
  url: string;
}

async function requestRemoveBackground(imageUrl: string): Promise<string> {
  // No offline fallback for this operation — always needs the backend.
  if (isOffline()) {
    throw new Error("Offline: removing the background requires a network connection.");
  }
  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/remove-background"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl }),
    });
  } catch {
    throw new Error("Failed to reach the backend to remove the background.");
  }
  if (!res.ok) {
    if (res.status === 503) {
      throw new Error("Background removal is not configured on this backend.");
    }
    throw new Error(`Background removal failed (${res.status})`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) {
    throw new Error("Background removal returned no url");
  }
  return data.url;
}

/** Remove the background from an arbitrary image url — no scene node involved. */
export async function removeBackgroundFromUrl(url: string): Promise<RemoveBackgroundResult> {
  const resultUrl = await requestRemoveBackground(url);
  return { url: resultUrl };
}

/**
 * Remove the background of a node's (first) image fill and write the result
 * back onto that same fill, preserving its `mode`/`crop`/`adjustments`.
 */
export async function removeBackgroundOnNode(nodeId: string): Promise<RemoveBackgroundResult> {
  const paint = findNodeImagePaint(nodeId);
  const sourceUrl = await resolveNodeImageUrl(nodeId);
  const resultUrl = await requestRemoveBackground(sourceUrl);
  applyImagePaintUrl(nodeId, paint.id, resultUrl);
  return { url: resultUrl };
}
