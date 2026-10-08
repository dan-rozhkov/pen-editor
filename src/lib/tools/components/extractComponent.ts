import {
  extractMasterDraft,
  parseMaster,
  reconcileHtml,
  replaceWithInstances,
  validateMaster,
} from "@/lib/embedComponents";
import { COMPONENTS_PAGE_NAME, selectComponentRegistry } from "@/store/componentRegistry";
import { applyEmbedHtmlUpdates, listAllEmbeds, upsertMasterNode, type EmbedHtmlUpdate } from "@/store/componentOps";
import { usePageStore } from "@/store/pageStore";
import type { ToolHandler } from "../../toolRegistry";
import { KEY_RULE, findEmbed, inOneHistoryStep, readKey, toolError } from "./shared";

/**
 * extract_component: promote an element of an embed to a component master
 * and replace it (and, with `replaceSimilar`, every structurally equal
 * element in other embeds) with instances.
 */
export const extractComponent: ToolHandler = async (args) => {
  const key = readKey(args);
  if (!key) return toolError(`Invalid key: ${KEY_RULE}`);
  if (typeof args.name !== "string" || !args.name.trim()) return toolError("name is required");
  if (typeof args.selector !== "string" || !args.selector.trim()) return toolError("selector is required");
  const origin = findEmbed(args.nodeId);
  if (!origin) return toolError(`Embed ${String(args.nodeId)} not found (nodeId must be an embed node)`);
  if (origin.node.component) {
    return toolError(`Embed ${origin.node.id} is itself a component master; extract from a screen embed`);
  }

  const registry = selectComponentRegistry();
  if (registry.has(key)) {
    return toolError(`Component "${key}" already exists. Use define_component to change it, or pick another key.`);
  }

  const draft = extractMasterDraft(origin.node.htmlContent, args.selector, key);
  if (!draft.ok) return toolError(draft.error);
  const validated = validateMaster(draft.extraction.masterHtml, key);
  if (!validated.ok) return toolError(`Cannot extract "${key}": ${validated.errors.join("; ")}`);

  const replaceSimilar = args.replaceSimilar === true;
  const { activePageId, pages } = usePageStore.getState();
  const componentsPage = pages.find((p) => p.name === COMPONENTS_PAGE_NAME);
  const touchesActive =
    origin.isActive ||
    componentsPage?.id === activePageId ||
    (replaceSimilar && listAllEmbeds().some((e) => e.isActive && !e.node.component));

  let replacedTotal = 0;
  let embedsUpdated = 0;
  let masterNodeId = "";
  inOneHistoryStep(touchesActive, () => {
    const written = upsertMasterNode({ meta: { key, name: args.name as string }, html: validated.master.html });
    masterNodeId = written.nodeId;
    const live = selectComponentRegistry();
    const master = live.get(key);
    const parsed = master ? parseMaster(master) : null;
    if (!parsed) return;

    const updates: EmbedHtmlUpdate[] = [];
    const candidates = replaceSimilar
      ? listAllEmbeds().filter((e) => !e.node.component && e.node.htmlContent)
      : [origin];
    for (const entry of candidates) {
      let html = entry.node.htmlContent;
      let replaced = 0;
      if (entry.node.id === origin.node.id) {
        const r = replaceWithInstances(html, parsed, { selector: args.selector as string });
        html = r.html;
        replaced += r.replaced;
      }
      if (replaceSimilar) {
        const r = replaceWithInstances(html, parsed, {
          similarTo: draft.extraction.signature,
          tag: draft.extraction.tag,
        });
        html = r.html;
        replaced += r.replaced;
      }
      if (replaced === 0) continue;
      updates.push({ nodeId: entry.node.id, html: reconcileHtml(html, live) });
      replacedTotal += replaced;
    }
    embedsUpdated = applyEmbedHtmlUpdates(updates);
  });

  if (replacedTotal === 0) return toolError("Nothing was replaced; the selector no longer matches.");
  const stored = selectComponentRegistry().get(key);
  const parsed = stored ? parseMaster(stored) : null;
  return JSON.stringify({
    key,
    masterNodeId,
    replaced: replacedTotal,
    embedsUpdated,
    slots: parsed?.slots ?? [],
    rev: parsed?.rev,
  });
};
