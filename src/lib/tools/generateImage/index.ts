import type { ToolHandler } from "@/lib/toolRegistry";
import { resolveApiUrl, isOffline } from "@/lib/apiBase";
import { useSceneStore } from "@/store/sceneStore";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";

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
    return JSON.stringify({ url, prompt });
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
    useSceneStore.getState().updateNode(frameId, {
      fills: [createImagePaint({ url, mode: "fill" })],
      ...clearLegacyFillProps(),
    });
    return JSON.stringify({ success: true, url, frame_id: frameId });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
};
