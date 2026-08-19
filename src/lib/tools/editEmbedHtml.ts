import { useSceneStore } from "@/store/sceneStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import {
  collectDocumentComponents,
  buildDocumentComponentTagMap,
} from "@/lib/documentComponents";
import { normalizeEmbedHtmlForStorage } from "@/utils/embedTemplateUtils";
import { applyAnchorEdits, type AnchorEdit } from "@/lib/embedHtmlEdit/applyAnchorEdits";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

/**
 * Document component usage inside embed HTML, e.g. `<c-user-card />`. The
 * trailing `[\s/>]` keeps ordinary text like `for (i = 0; i<c-1; i++)` out.
 */
const COMPONENT_TAG_RE = /<c-[a-z0-9-]+[\s/>]/i;

/** Coerce the tool args into AnchorEdit[], or null when unusable. */
function parseEdits(raw: unknown): AnchorEdit[] | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const edits: AnchorEdit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { oldString, newString, replaceAll } = item as Record<string, unknown>;
    if (typeof oldString !== "string" || typeof newString !== "string") return null;
    edits.push({
      oldString,
      newString,
      ...(replaceAll === true ? { replaceAll: true } : {}),
    });
  }
  return edits;
}

export const editEmbedHtml: ToolHandler = async (args) => {
  const nodeId = typeof args.nodeId === "string" ? args.nodeId : "";
  if (!nodeId) return JSON.stringify({ error: "nodeId is required" });

  const edits = parseEdits(args.edits);
  if (!edits) return JSON.stringify({ error: "edits must be an array of {oldString, newString}" });
  if (edits.length === 0) return JSON.stringify({ error: "No edits provided" });

  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return JSON.stringify({ error: `Node ${nodeId} not found` });
  if (node.type !== "embed") {
    return JSON.stringify({
      error: `Node ${nodeId} is a "${node.type}" node, not an embed. edit_embed_html only edits embed screens.`,
    });
  }

  const embed = node as unknown as EmbedNode;
  // The authoring text is sourceTemplate when it exists — htmlContent is its
  // expanded form and would be overwritten on the next expansion.
  const targetedSourceTemplate =
    typeof embed.sourceTemplate === "string" && embed.sourceTemplate.length > 0;
  const source = targetedSourceTemplate ? (embed.sourceTemplate as string) : embed.htmlContent;

  let edited;
  try {
    edited = applyAnchorEdits(source, edits);
  } catch (err) {
    // Nothing was written to the store — the failure is fully atomic.
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  const docComponents = collectDocumentComponents(
    state.nodesById,
    state.componentArtifactsById,
    state.childrenById,
  );
  const tagMap = buildDocumentComponentTagMap(docComponents);
  const normalized = normalizeEmbedHtmlForStorage(edited.html, tagMap);

  const updated = { ...embed } as EmbedNode;

  if (normalized.sourceTemplate) {
    updated.htmlContent = normalized.htmlContent;
    updated.sourceTemplate = normalized.sourceTemplate;
  } else if (targetedSourceTemplate && COMPONENT_TAG_RE.test(edited.html)) {
    // The screen WAS a template and still carries <c-*> tags, yet none of them
    // expanded — the component was renamed or deleted. Storing the unexpanded
    // template as htmlContent would wipe the rendered markup, so refuse.
    return JSON.stringify({
      error:
        "The edited HTML references component tags that no longer resolve, so nothing was changed. " +
        "Recreate the component, or replace the <c-*> tag with plain markup in the same edit." +
        (normalized.issues.length > 0 ? ` Issues: ${normalized.issues.join("; ")}` : ""),
    });
  } else {
    // Nothing expanded and nothing to lose: the edited text IS the stored html.
    // A leftover template would silently resurrect the pre-edit markup.
    updated.htmlContent = normalized.htmlContent;
    delete updated.sourceTemplate;
  }

  const issues = normalized.issues;

  const newNodesById: Record<string, FlatSceneNode> = {
    ...state.nodesById,
    [nodeId]: updated as unknown as FlatSceneNode,
  };

  saveHistory(state);
  useSceneStore.setState({ nodesById: newNodesById, _cachedTree: null });

  return JSON.stringify({
    nodeId,
    editsApplied: edits.length,
    replacements: edited.replacements,
    htmlLength: updated.htmlContent.length,
    targetedSourceTemplate,
    issues,
  });
};
