import { toast } from "sonner";
import { buildTree } from "@/types/scene";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useStyleStore } from "@/store/styleStore";
import { useThemeStore } from "@/store/themeStore";
import { useDocumentStore } from "@/store/documentStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useCommentsStore } from "@/store/commentsStore";
import { usePageStore } from "@/store/pageStore";
import { downloadDocument, downloadPublicPen, openFilePicker } from "@/utils/fileUtils";
import type { DocumentData } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { toDtcg, fromDtcg, type ImportResult } from "@/lib/designTokens";
import type { DtcgDocument } from "@/lib/designTokens";
import { useHistoryStore } from "@/store/historyStore";
import { saveShareCredentials } from "@/lib/shareCanvas";
import { openSettings } from "@/lib/openSettings";
import { formatShortcut } from "./shortcutFormat";
import type { PaletteCommand } from "./types";

/**
 * Document-level file operations (open/export/import), consumed by both the
 * Toolbar's File menu and the command palette.
 */

/**
 * The ONE builder of "what is the current document" (all pages, variables, styles,
 * theme) in the shape `serializeDocument`/`applyOpenedDocument` expect. It does not
 * mutate any store: the active page is read from the live stores (scene, guides,
 * measurements, comments), where its data lives until the page is switched away from;
 * other pages come from pageStore. `collectDocumentData()` (export, share) and the desktop
 * canvas autosave both use it, so they can never gather the document two different ways.
 */
export function buildLiveDocumentData(): DocumentData {
  const { pages, activePageId } = usePageStore.getState();
  const scene = useSceneStore.getState();
  return {
    pages: pages.map((page) =>
      page.id === activePageId
        ? {
            id: page.id,
            name: page.name,
            nodes: buildTree(scene.rootIds, scene.nodesById, scene.childrenById),
            pageBackground: scene.pageBackground,
            guides: useGuidesStore.getState().guides,
            slideOrder: scene.slideOrder,
            measurements: useMeasurementsStore.getState().measurements,
            comments: useCommentsStore.getState().threads,
          }
        : {
            id: page.id,
            name: page.name,
            nodes: buildTree(page.rootIds, page.nodesById, page.childrenById),
            pageBackground: page.pageBackground,
            guides: page.guides,
            slideOrder: page.slideOrder,
            measurements: page.measurements,
            comments: page.comments,
          },
    ),
    variables: useVariableStore.getState().variables,
    textStyles: useTextStyleStore.getState().textStyles,
    fillStyles: useStyleStore.getState().fillStyles,
    effectStyles: useStyleStore.getState().effectStyles,
    activeTheme: useThemeStore.getState().activeTheme,
  };
}

/**
 * The live document for export and sharing: `exportAsJson()` below and canvas sharing
 * (`src/lib/shareCanvas.ts`) call it. Unlike `buildLiveDocumentData()` it first writes the
 * active page back into pageStore (`saveCurrentPageState`), which export/share rely on.
 */
export function collectDocumentData(): DocumentData {
  usePageStore.getState().saveCurrentPageState();
  return buildLiveDocumentData();
}

export function exportAsJson(): void {
  const { pages, variables, textStyles, fillStyles, effectStyles, activeTheme } =
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
  );
}

export function exportDesignTokens(): void {
  const { document: tokensDoc, warnings } = toDtcg({
    variables: useVariableStore.getState().variables,
    fillStyles: useStyleStore.getState().fillStyles,
    effectStyles: useStyleStore.getState().effectStyles,
    textStyles: useTextStyleStore.getState().textStyles,
  });
  const name = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
  const blob = new Blob([JSON.stringify(tokensDoc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.tokens.json`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(
    warnings.length
      ? `Exported design tokens. ${warnings.length} item(s) skipped or downgraded.`
      : "Exported design tokens.",
  );
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
  varStore.setVariables(mergeById(varStore.variables, result.variables));
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
    {
      id: "app-open-settings",
      label: "Open settings",
      group: "File",
      shortcut: formatShortcut(["mod", ","]),
      keywords: ["preferences", "options", "theme", "account"],
      run: () => openSettings(),
    },
    { id: "file-open", label: "Open…", group: "File", keywords: ["open file", "load"], run: () => void openDocument() },
    { id: "file-export-json", label: "Export as .json", group: "File", keywords: ["save", "download"], run: exportAsJson },
    { id: "file-export-pen", label: "Export as .pen", group: "File", keywords: ["save", "download"], run: exportAsPen },
    { id: "file-export-tokens", label: "Export tokens as .tokens.json", group: "File", keywords: ["dtcg", "tokens", "download", "export"], run: exportDesignTokens },
    { id: "file-import-tokens", label: "Import design tokens", group: "File", keywords: ["dtcg", "tokens", "upload", "import"], run: () => void importDesignTokens() },
  ];
}
