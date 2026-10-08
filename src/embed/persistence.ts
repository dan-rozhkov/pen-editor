// Autosave/restore of the widget's document. The widget has no cloud
// document, so localStorage is the only continuity between two renders of the
// same conversation. Sandboxed iframes may deny storage outright (reads and
// writes throw): every touch is guarded, and the widget works without it.
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { deserializeDocument, serializeDocument } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { useSceneStore } from "@/store/sceneStore";

export const EMBED_DOC_KEY = "sideform.embed.doc";
const AUTOSAVE_DEBOUNCE_MS = 1_000;

export const embedDocKey = (widgetKey: string): string => `${EMBED_DOC_KEY}:${widgetKey}`;

export function restoreEmbedDocument(widgetKey: string, viewport = { width: window.innerWidth, height: window.innerHeight }): boolean {
  try {
    const raw = localStorage.getItem(embedDocKey(widgetKey));
    if (!raw) return false;
    applyOpenedDocument(deserializeDocument(raw), { viewportWidth: viewport.width, viewportHeight: viewport.height });
    return true;
  } catch {
    return false;
  }
}

export function saveEmbedDocument(widgetKey: string): boolean {
  try {
    const doc = collectDocumentData();
    localStorage.setItem(
      embedDocKey(widgetKey),
      serializeDocument(doc.pages, doc.variables, doc.activeTheme, doc.textStyles, doc.fillStyles, doc.effectStyles, doc.variableCollections, doc.modeContext),
    );
    return true;
  } catch {
    // Storage denied or full — keep working, just without persistence.
    return false;
  }
}

export function startEmbedAutosave(widgetKey: string, debounceMs = AUTOSAVE_DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useSceneStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveEmbedDocument(widgetKey);
    }, debounceMs);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
