import type { ToolHandler } from "@/lib/toolRegistry";
import {
  MAX_VECTORIZE_NODES,
  vectorizeFromUrl,
  vectorizeNode,
  type VectorizeMode,
} from "@/lib/imageOps/vectorize";
import { recordIssuedImageUrl } from "@/lib/tools/generateImage/registry";

// Mirrors the backend schema's `mode: z.enum(["layers", "image"]).default("layers")`
// (pen-editor-backend/src/ai/tools.ts) — the two halves of this contract
// must agree on the fallback, or an omitted `mode` reads as one thing on the
// backend's declared default and another wherever this fallback actually
// runs.
function parseMode(raw: unknown): VectorizeMode {
  return raw === "image" ? "image" : "layers";
}

/**
 * Client-executed AI tool: thin wrapper over `src/lib/imageOps/vectorize.ts`
 * (the same core the "Vectorize" panel button calls). Parses args, calls the
 * core, reports the result — no operation logic lives here.
 */
export const vectorizeImage: ToolHandler = async (args) => {
  const nodeId = typeof args.node_id === "string" ? args.node_id : undefined;
  const imageUrl = typeof args.image_url === "string" ? args.image_url : undefined;
  const mode = parseMode(args.mode);

  if (!nodeId && !imageUrl) {
    return JSON.stringify({ error: "Provide either node_id or image_url." });
  }

  try {
    const result = nodeId
      ? await vectorizeNode(nodeId, { mode })
      : await vectorizeFromUrl(imageUrl as string, { mode });
    recordIssuedImageUrl(result.url);

    const notes: string[] = [];
    if (result.tooComplex) {
      notes.push(
        `The vectorized SVG has ${result.nodeCount} nodes, over the ${MAX_VECTORIZE_NODES}-node ` +
          `limit for inserting as editable layers, so nothing was inserted into the scene. Retrying ` +
          `won't change the result — either use mode: "image" to place the SVG as a single image ` +
          `fill instead, or vectorize a simpler source image.`,
      );
    }
    if (result.droppedShapes) {
      notes.push(
        `${result.droppedShapes} shape(s) from the source image were dropped during vectorization ` +
          `(they had no visible fill or stroke to trace) and are missing from this result. The result ` +
          `is still usable, but treat it as incomplete rather than a faithful trace.`,
      );
    }
    if (notes.length > 0) {
      return JSON.stringify({ ...result, note: notes.join(" ") });
    }
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
};
