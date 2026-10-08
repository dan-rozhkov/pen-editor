import { useSceneStore } from "@/store/sceneStore";
import { buildOutline, grepHtml } from "@/lib/embedHtmlEdit/readViews";
import { collapseComponentRegions } from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import type { EmbedNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

const FULL_WARN_THRESHOLD = 20_000;

function intArg(raw: unknown, fallback: number, min: number, max: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export const readEmbedHtml: ToolHandler = async (args) => {
  const nodeId = typeof args.nodeId === "string" ? args.nodeId : "";
  if (!nodeId) return JSON.stringify({ error: "nodeId is required" });

  const node = useSceneStore.getState().nodesById[nodeId];
  if (!node) return JSON.stringify({ error: `Node ${nodeId} not found` });
  if (node.type !== "embed") {
    return JSON.stringify({
      error: `Node ${nodeId} is a "${node.type}" node, not an embed. read_embed_html only reads embed screens.`,
    });
  }

  const embed = node as unknown as EmbedNode;
  // Compact (default) shows each canonical component region as a `<c-key>` tag.
  // A master is its own source text, so it is always read as stored.
  const view = args.view === "expanded" || embed.component ? "expanded" : "compact";
  const html =
    view === "compact"
      ? collapseComponentRegions(embed.htmlContent, selectComponentRegistry())
      : embed.htmlContent;

  const mode = args.mode === "grep" || args.mode === "full" ? args.mode : "outline";

  if (mode === "grep") {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (pattern.length === 0) {
      return JSON.stringify({ error: "pattern is required when mode is 'grep'" });
    }
    const grep = grepHtml(html, pattern, intArg(args.contextLines, 2, 0, 20));
    return JSON.stringify({ nodeId, mode, view, ...grep });
  }

  if (mode === "full") {
    return JSON.stringify({
      nodeId,
      mode,
      view,
      html,
      ...(html.length > FULL_WARN_THRESHOLD
        ? {
            warning:
              `This document is ${html.length} characters. Prefer mode "outline" or "grep" — ` +
              "reading a whole screen to change part of it wastes most of the tokens.",
          }
        : {}),
    });
  }

  return JSON.stringify({
    nodeId,
    mode,
    view,
    outline: buildOutline(html, intArg(args.maxDepth, 4, 1, 12)),
  });
};
