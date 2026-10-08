import { detachRegions } from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { applyEmbedHtmlUpdates } from "@/store/componentOps";
import type { ToolHandler } from "../../toolRegistry";
import { findEmbed, toolError } from "./shared";

/**
 * detach_instance: remove the component markers from one region. The HTML
 * stays as it is, and keeps its look (the master's CSS is carried as a
 * static, re-scoped style block).
 */
export const detachInstance: ToolHandler = async (args) => {
  const target = findEmbed(args.nodeId);
  if (!target) return toolError(`Embed ${String(args.nodeId)} not found (nodeId must be an embed node)`);
  if (typeof args.selector !== "string" || !args.selector.trim()) return toolError("selector is required");
  if (target.node.component) {
    return toolError(`Embed ${target.node.id} is a component master; it has no instance to detach`);
  }

  const result = detachRegions(target.node.htmlContent, selectComponentRegistry(), {
    selector: args.selector,
  });
  if (result.detached === 0) {
    return toolError(`No component instance at selector "${args.selector}" in embed ${target.node.id}`);
  }
  applyEmbedHtmlUpdates([{ nodeId: target.node.id, html: result.html }]);
  return JSON.stringify({ nodeId: target.node.id, detached: result.detached });
};
