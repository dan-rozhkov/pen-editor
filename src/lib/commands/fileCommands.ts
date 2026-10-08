import { toast } from "sonner";
import { buildTree } from "@/types/scene";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useStyleStore } from "@/store/styleStore";
import { useThemeStore } from "@/store/themeStore";
import { useDocumentStore } from "@/store/documentStore";
import { usePageStore } from "@/store/pageStore";
import { downloadDocument, downloadPublicPen, openFilePicker } from "@/utils/fileUtils";
import type { DocumentData } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { toDtcg, fromDtcg, toCss, toTailwindTheme, type ImportResult } from "@/lib/designTokens";
import { THEME_COLLECTION_ID } from "@/types/variable";
import type { DtcgDocument } from "@/lib/designTokens";
import { useHistoryStore } from "@/store/historyStore";
import { saveShareCredentials } from "@/lib/shareCanvas";
import type { PaletteCommand } from "./types";

/**
 * Document-level file operations (open/export/import), consumed by both the
 * Toolbar's File menu and the command palette.
 */

/**
 * Gathers the live document state (all pages, variables, styles, theme) into
 * the shape `serializeDocument`/`applyOpenedDocument` expect. This is the
 * single source of truth for "what is the current document" — both
 * `exportAsJson()` below and canvas sharing (`src/lib/shareCanvas.ts`) call
 * it, so a `.json` export and a shared link can never drift apart by
 * gathering the live document two different ways.
 */
export function collectDocumentData(): DocumentData {
  usePageStore.getState().saveCurrentPageState();
  const { pages } = usePageStore.getState();
  return {
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      nodes: buildTree(page.rootIds, page.nodesById, page.childrenById),
      pageBackground: page.pageBackground,
      guides: page.guides,
      slideOrder: page.slideOrder,
      measurements: page.measurements,
      comments: page.comments,
    })),
    variables: useVariableStore.getState().variables,
    variableCollections: useVariableStore.getState().collections,
    textStyles: useTextStyleStore.getState().textStyles,
    fillStyles: useStyleStore.getState().fillStyles,
    effectStyles: useStyleStore.getState().effectStyles,
    activeTheme: useThemeStore.getState().activeTheme,
    modeContext: { ...useThemeStore.getState().modeContext },
  };
}

export function exportAsJson(): void {
  const { pages, variables, variableCollections, textStyles, fillStyles, effectStyles, activeTheme, modeContext } =
    collectDocumentData();
  const name = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
  downloadDocument(
    pages,
    variables,
    activeTheme,
    `${name}.json`,
    textStyles,
    fillStyles,
    effectStyles,
    variableCollections,
    modeContext,
  );
}

export function exportAsPen(): void {
  const currentPageNodes = useSceneStore.getState().getNodes();
  const name = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
  downloadPublicPen(
    currentPageNodes,
    useVariableStore.getState().variables,
    useThemeStore.getState().activeTheme,
    `${name}.pen`,
    useVariableStore.getState().collections,
  );
}

function documentBaseName(): string {
  return useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
}

function downloadText(text: string, mime: string, fileName: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportDesignTokens(): void {
  const { document: tokensDoc, warnings } = toDtcg({
    variables: useVariableStore.getState().variables,
    collections: useVariableStore.getState().collections,
    fillStyles: useStyleStore.getState().fillStyles,
    effectStyles: useStyleStore.getState().effectStyles,
    textStyles: useTextStyleStore.getState().textStyles,
  });
  downloadText(JSON.stringify(tokensDoc, null, 2), "application/json", `${documentBaseName()}.tokens.json`);
  toast(
    warnings.length
      ? `Exported design tokens. ${warnings.length} item(s) skipped or downgraded.`
      : "Exported design tokens.",
  );
}

function exportCssTokens(
  build: typeof toCss,
  suffix: string,
  label: string,
): void {
  const { css, warnings } = build({
    variables: useVariableStore.getState().variables,
    collections: useVariableStore.getState().collections,
  });
  downloadText(css, "text/css", `${documentBaseName()}${suffix}`);
  toast(warnings.length ? `Exported ${label}. ${warnings.length} item(s) renamed or downgraded.` : `Exported ${label}.`);
}

export function exportTokensCss(): void {
  exportCssTokens(toCss, ".tokens.css", "tokens.css");
}

export function exportTailwindTheme(): void {
  exportCssTokens(toTailwindTheme, ".tailwind.css", "Tailwind theme");
}

// Known limitation: foreign tokens (no com.peneditor extension) get a fresh generated id on
// every import, since there's no stable id to key off — so re-importing the same foreign file
// appends duplicates rather than updating in place. Our own exported files carry stable ids in
// $extensions["com.peneditor"] and round-trip cleanly (re-import overwrites by id, no dupes).
function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}

function applyImport(result: ImportResult): void {
  // One undo step for the whole import (the setX setters don't snapshot).
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  const varStore = useVariableStore.getState();
  const styleStore = useStyleStore.getState();
  const textStore = useTextStyleStore.getState();
  // The existing Theme collection wins over an imported one: it may carry modes the file does not know.
  const incoming = result.collections.filter(
    (c) => c.id !== THEME_COLLECTION_ID || !varStore.collections.some((e) => e.id === THEME_COLLECTION_ID),
  );
  varStore.replaceAll(
    mergeById(varStore.variables, result.variables),
    mergeById(varStore.collections, incoming),
  );
  styleStore.setFillStyles(mergeById(styleStore.fillStyles, result.fillStyles));
  styleStore.setEffectStyles(mergeById(styleStore.effectStyles, result.effectStyles));
  textStore.setTextStyles(mergeById(textStore.textStyles, result.textStyles));
}

export async function importDesignTokens(): Promise<void> {
  const text = await pickTokensFile();
  if (text == null) return; // user cancelled
  let doc: DtcgDocument;
  try {
    doc = JSON.parse(text) as DtcgDocument;
  } catch {
    toast("That file isn't valid JSON.");
    return;
  }
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
    toast("That file doesn't look like a design-tokens document.");
    return;
  }
  const { result, warnings } = fromDtcg(doc);
  applyImport(result);
  const count =
    result.variables.length + result.fillStyles.length + result.effectStyles.length + result.textStyles.length;
  toast(
    warnings.length
      ? `Imported ${count} token(s). ${warnings.length} skipped or downgraded.`
      : `Imported ${count} token(s).`,
  );
}

/** Prompt for a .tokens.json / .json file; resolve its text, or null if cancelled. */
function pickTokensFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tokens.json,.json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      resolve(await file.text());
    };
    // Modern browsers fire `cancel` on the <input> when the OS file dialog is dismissed
    // without a selection; without this, cancelling would leave the promise unresolved forever.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function openDocument(): Promise<void> {
  try {
    const result = await openFilePicker();
    useDocumentStore.getState().setFileName(result.fileName);
    // Opening a different document invalidates any share link created for
    // whatever was open before — the stored credentials point at that old
    // document's server-side copy, not this one.
    saveShareCredentials(null);
    const { width: viewportWidth, height: viewportHeight } = getCanvasViewportMetrics();
    applyOpenedDocument(result, { viewportWidth, viewportHeight });
  } catch (err) {
    console.error("Failed to open file:", err);
  }
}

export function getFileCommands(): PaletteCommand[] {
  return [
    { id: "file-open", label: "Open…", group: "File", keywords: ["open file", "load"], run: () => void openDocument() },
    { id: "file-export-json", label: "Export as .json", group: "File", keywords: ["save", "download"], run: exportAsJson },
    { id: "file-export-pen", label: "Export as .pen", group: "File", keywords: ["save", "download"], run: exportAsPen },
    { id: "file-export-tokens", label: "Export tokens as .tokens.json", group: "File", keywords: ["dtcg", "tokens", "download", "export"], run: exportDesignTokens },
    { id: "file-import-tokens", label: "Import design tokens", group: "File", keywords: ["dtcg", "tokens", "upload", "import"], run: () => void importDesignTokens() },
    { id: "file-export-tokens-css", label: "Export tokens as tokens.css", group: "File", keywords: ["css", "custom properties", "tokens", "download", "export"], run: exportTokensCss },
    { id: "file-export-tailwind-theme", label: "Export tokens as Tailwind theme", group: "File", keywords: ["tailwind", "theme", "css", "tokens", "download", "export"], run: exportTailwindTheme },
  ];
}
