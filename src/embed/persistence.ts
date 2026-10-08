// Autosave/restore of the widget's document. The widget has no cloud
// document, so localStorage is the only continuity between two renders of the
// same conversation. Sandboxed iframes may deny storage outright (reads and
// writes throw): every touch is guarded, and the widget works without it.
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { deserializeDocument, serializeDocumentData } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";

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
    localStorage.setItem(embedDocKey(widgetKey), serializeDocumentData(collectDocumentData()));
    return true;
  } catch {
    // Storage denied or full — keep working, just without persistence.
    return false;
  }
}

export function startEmbedAutosave(widgetKey: string, debounceMs = AUTOSAVE_DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveEmbedDocument(widgetKey);
    }, debounceMs);
  };
  // Scene, variables/collections and saved scopes all live in the saved document.
  const unsubscribes = [useSceneStore, useVariableStore, useDesignSystemScopeStore].map((store) => store.subscribe(schedule));
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
