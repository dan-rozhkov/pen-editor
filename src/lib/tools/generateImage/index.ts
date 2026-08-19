import type { ToolHandler } from "@/lib/toolRegistry";
import { resolveApiUrl, isOffline } from "@/lib/apiBase";
import { useSceneStore } from "@/store/sceneStore";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";
import { recordIssuedImageUrl } from "./registry";

// The backend only uploads to S3/R2 when S3_* env vars are configured;
// without them /api/generate-image returns a multi-MB base64 `data:` url
// directly instead of a hosted link. That's fine to show or describe in
// chat, but pasting it into embed HTML truncates (the string is huge) and
// blows the context window, so the model needs an explicit heads-up rather
// than discovering it by trying.
function dataUrlNote(): string {
  return (
    "This is an inline base64 data URL, not a hosted image link. It is fine to show in chat, but do NOT " +
    "paste it into embed HTML (htmlContent) — it will truncate and waste context. For this image spot, " +
    "use a placeholder instead: https://picsum.photos/seed/{unique}/{w}/{h}."
  );
}

async function requestGeneratedImage(prompt: string): Promise<string> {
  // Fail immediately instead of letting a request hang or reject once the
  // browser notices there's no connection — image generation always needs
  // the backend, there's no offline fallback.
  if (isOffline()) {
    throw new Error("Offline: image generation requires a network connection.");
  }
  const res = await fetch(resolveApiUrl("/api/generate-image"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`Image generation failed (${res.status})`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("Image generation returned no url");
  return data.url;
}

export const generateImage: ToolHandler = async (args) => {
  const prompt = args.prompt as string;
  try {
    const url = await requestGeneratedImage(prompt);
    recordIssuedImageUrl(url);
    const note = url.startsWith("data:") ? dataUrlNote() : undefined;
    return JSON.stringify({ url, prompt, ...(note ? { note } : {}) });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
};

export const generateFrameImage: ToolHandler = async (args) => {
  const prompt = args.prompt as string;
  const frameId = args.frame_id as string;
  const node = useSceneStore.getState().nodesById[frameId];
  if (!node) {
    return JSON.stringify({ error: `Frame ${frameId} not found` });
  }
  try {
    const url = await requestGeneratedImage(prompt);
    recordIssuedImageUrl(url);
    // The fill is set from the data url exactly as before — that path never
    // touches embed HTML, so only the model-facing note below is new.
    useSceneStore.getState().updateNode(frameId, {
      fills: [createImagePaint({ url, mode: "fill" })],
      ...clearLegacyFillProps(),
    });
    const note = url.startsWith("data:") ? dataUrlNote() : undefined;
    return JSON.stringify({
      success: true,
      url,
      frame_id: frameId,
      ...(note ? { note } : {}),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
};
