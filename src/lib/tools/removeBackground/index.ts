import type { ToolHandler } from "@/lib/toolRegistry";
import { removeBackgroundFromUrl, removeBackgroundOnNode } from "@/lib/imageOps/removeBackground";
import { recordIssuedImageUrl } from "@/lib/tools/generateImage/registry";

/**
 * Client-executed AI tool: thin wrapper over `src/lib/imageOps/removeBackground.ts`
 * (the same core the "Remove background" panel button calls). Parses args,
 * calls the core, reports the result — no operation logic lives here.
 */
export const removeBackground: ToolHandler = async (args) => {
  const nodeId = typeof args.node_id === "string" ? args.node_id : undefined;
  const imageUrl = typeof args.image_url === "string" ? args.image_url : undefined;

  if (!nodeId && !imageUrl) {
    return JSON.stringify({ error: "Provide either node_id or image_url." });
  }

  try {
    const result = nodeId
      ? await removeBackgroundOnNode(nodeId)
      : await removeBackgroundFromUrl(imageUrl as string);
    recordIssuedImageUrl(result.url);
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
};
