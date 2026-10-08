import { detachRegions } from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { applyEmbedHtmlUpdates, listAllEmbeds, removeMasterNode, type EmbedHtmlUpdate } from "@/store/componentOps";
import { libraryComponentError } from "@/lib/designSystem/ownership";
import type { ToolHandler } from "../../toolRegistry";
import { KEY_RULE, inOneHistoryStep, readKey, toolError } from "./shared";

/**
 * delete_component: detach every instance (the markup stays), then delete the
 * master. Never erases instance markup.
 */
export const deleteComponent: ToolHandler = async (args) => {
  const key = readKey(args);
  if (!key) return toolError(`Invalid key: ${KEY_RULE}`);
  const registry = selectComponentRegistry();
  if (!registry.has(key)) return toolError(`Component "${key}" not found`);
  const libraryRefusal = libraryComponentError(key, registry.get(key)?.meta);
  if (libraryRefusal) return toolError(libraryRefusal);

  let detachedInstances = 0;
  let embedsUpdated = 0;
  const hasActive = listAllEmbeds().some((e) => e.isActive);
  inOneHistoryStep(hasActive, () => {
    const updates: EmbedHtmlUpdate[] = [];
    for (const entry of listAllEmbeds()) {
      const html = entry.node.htmlContent;
      // The master being deleted is removed below; its own text is not rewritten.
      if (entry.node.component?.key === key) continue;
      if (!html || !html.includes("data-c")) continue;
      const result = detachRegions(html, registry, { key });
      if (result.detached === 0) continue;
      detachedInstances += result.detached;
      updates.push({ nodeId: entry.node.id, html: result.html });
    }
    embedsUpdated = applyEmbedHtmlUpdates(updates);
    removeMasterNode(key);
  });

  return JSON.stringify({ key, detachedInstances, embedsUpdated });
};
