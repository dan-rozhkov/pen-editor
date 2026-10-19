import type { ToolHandler } from "../toolRegistry";
import { createDoc, getDoc, listDocs, updateDoc } from "../docs/docStore";
import { applyDocEdits, type DocEdit } from "../docs/applyDocEdits";
import { getAgentPanelDocsBridge } from "../agentPanel";

// Panel-local (canvasLink/canvasTools.ts, prefix "doc_"): markdown documents live in this
// browser's localStorage (docs/docStore.ts) and the desktop shell shows them in a /doc tab.
// Advertised by the backend only when clientCapabilities.docTabs is true. Output: JSON string,
// `{"error": "..."}` on failure.

const err = (message: string): string => JSON.stringify({ error: message });

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Opens the doc tab. Returns an error message, or undefined on success. */
async function openTab(docId: string): Promise<string | undefined> {
  const bridge = getAgentPanelDocsBridge();
  if (!bridge) return "Document tabs are not available here (desktop app only). The document exists but no tab was opened.";
  try {
    const result = await bridge.open(docId);
    return result.ok ? undefined : result.error || "The document tab could not be opened.";
  } catch (e) {
    return e instanceof Error ? e.message : "The document tab could not be opened.";
  }
}

export const docList: ToolHandler = async () =>
  JSON.stringify({ documents: listDocs().map(({ id, title, updatedAt }) => ({ docId: id, title, updatedAt })) });

export const docCreate: ToolHandler = async (args) => {
  const title = str(args?.title);
  const markdown = str(args?.markdown);
  if (title === undefined || markdown === undefined) return err("title and markdown are required strings.");
  let doc;
  try {
    doc = createDoc({ title, markdown }, "agent");
  } catch (e) {
    return err(e instanceof Error ? e.message : "The document could not be saved.");
  }
  const openError = await openTab(doc.id);
  return JSON.stringify({ docId: doc.id, title: doc.title, ...(openError ? { openError } : {}) });
};

export const docRead: ToolHandler = async (args) => {
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  const doc = getDoc(docId);
  if (!doc) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);
  return JSON.stringify({ docId: doc.id, title: doc.title, markdown: doc.markdown });
};

export const docEdit: ToolHandler = async (args) => {
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  const edits = args?.edits as DocEdit[] | undefined;
  const markdown = str(args?.markdown);
  const title = str(args?.title);
  const hasEdits = Array.isArray(edits) && edits.length > 0;
  if (hasEdits && markdown !== undefined) return err("Pass either edits or markdown, not both.");
  if (!hasEdits && markdown === undefined && title === undefined) {
    return err("Nothing to change: pass edits, markdown or title.");
  }
  const doc = getDoc(docId);
  if (!doc) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);

  let nextMarkdown = markdown;
  let applied = markdown !== undefined ? 1 : 0;
  if (hasEdits) {
    const result = applyDocEdits(doc.markdown, edits);
    if (!result.ok) return err(result.error);
    nextMarkdown = result.markdown;
    applied = result.applied;
  }
  let updated;
  try {
    updated = updateDoc(docId, { ...(nextMarkdown !== undefined ? { markdown: nextMarkdown } : {}), ...(title !== undefined ? { title } : {}) }, "agent");
  } catch (e) {
    return err(e instanceof Error ? e.message : "The document could not be saved.");
  }
  if (!updated) return err(`Unknown docId "${docId}".`);
  return JSON.stringify({ docId: updated.id, title: updated.title, applied });
};

export const docOpen: ToolHandler = async (args) => {
  const docId = str(args?.docId);
  if (!docId) return err("docId is required.");
  if (!getDoc(docId)) return err(`Unknown docId "${docId}". Call doc_list to see the documents.`);
  const openError = await openTab(docId);
  return openError ? err(openError) : JSON.stringify({ docId, opened: true });
};
