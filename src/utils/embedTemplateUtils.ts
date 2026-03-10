import type { DocumentComponentDefinition } from "@/lib/documentComponents";
import {
  collectDocumentComponents,
  buildDocumentComponentTagMap,
} from "@/lib/documentComponents";
import { expandDocumentComponentTags } from "@/lib/documentComponents/expander";
import type { FlatSceneNode, EmbedNode } from "@/types/scene";

/**
 * Normalize embed HTML for storage.
 *
 * If the input contains document component tags (`<c-...>`), expands them
 * and returns both the authoring template and the expanded render HTML.
 * If no component tags are present, returns only htmlContent unchanged.
 */
export function normalizeEmbedHtmlForStorage(
  inputHtml: string,
  tagMap: Map<string, DocumentComponentDefinition>,
): {
  htmlContent: string;
  sourceTemplate?: string;
  issues: string[];
} {
  if (tagMap.size === 0) {
    return { htmlContent: inputHtml, issues: [] };
  }

  const { expandedHtml, changed, issues } = expandDocumentComponentTags(
    inputHtml,
    tagMap,
  );

  if (!changed) {
    return { htmlContent: inputHtml, issues };
  }

  return {
    htmlContent: expandedHtml,
    sourceTemplate: inputHtml,
    issues,
  };
}

/**
 * Re-expand all embed nodes that depend on components via sourceTemplate.
 *
 * Call this after a component's htmlContent changes. Mutates nodesById in place
 * and returns the IDs of nodes that were updated.
 */
export function propagateComponentChanges(
  nodesById: Record<string, FlatSceneNode>,
): string[] {
  const tagMap = buildDocumentComponentTagMap(
    collectDocumentComponents(nodesById),
  );
  if (tagMap.size === 0) return [];

  const updatedIds: string[] = [];

  for (const node of Object.values(nodesById)) {
    if (node.type !== "embed") continue;
    const embed = node as EmbedNode;
    // Only re-expand nodes that have a sourceTemplate (i.e. they use component tags)
    // and are NOT components themselves (components are the source, not dependents)
    if (!embed.sourceTemplate || embed.isComponent) continue;

    const { expandedHtml, changed } = expandDocumentComponentTags(
      embed.sourceTemplate,
      tagMap,
    );
    if (changed && expandedHtml !== embed.htmlContent) {
      // Clone before mutating to avoid corrupting history snapshots
      nodesById[embed.id] = { ...embed, htmlContent: expandedHtml } as FlatSceneNode;
      updatedIds.push(embed.id);
    }
  }

  return updatedIds;
}
