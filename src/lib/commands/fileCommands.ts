import { buildTree } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useStyleStore } from "@/store/styleStore";
import { useThemeStore } from "@/store/themeStore";
import { useDocumentStore } from "@/store/documentStore";
import { usePageStore } from "@/store/pageStore";
import { downloadDocument, downloadPublicPen, openFilePicker } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import type { PaletteCommand } from "./types";

/**
 * Mirrors the Toolbar's File menu handlers (`handleSave`/`handleExportPublicPen`/
 * `handleOpen`) — same underlying `fileUtils`/`openDocumentIntoEditor` calls,
 * just invoked from the palette instead of a dropdown item.
 */
function exportAsJson(): void {
  usePageStore.getState().saveCurrentPageState();
  const { pages, componentArtifactsById } = usePageStore.getState();
  const pagesForExport = pages.map((page) => ({
    id: page.id,
    name: page.name,
    nodes: buildTree(page.rootIds, page.nodesById, page.childrenById),
    pageBackground: page.pageBackground,
    guides: page.guides,
    slideOrder: page.slideOrder,
  }));
  const name = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
  downloadDocument(
    pagesForExport,
    useVariableStore.getState().variables,
    useThemeStore.getState().activeTheme,
    componentArtifactsById,
    `${name}.json`,
    useTextStyleStore.getState().textStyles,
    useStyleStore.getState().fillStyles,
    useStyleStore.getState().effectStyles,
  );
}

function exportAsPen(): void {
  const currentPageNodes = useSceneStore.getState().getNodes();
  const name = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
  downloadPublicPen(
    currentPageNodes,
    useVariableStore.getState().variables,
    useThemeStore.getState().activeTheme,
    `${name}.pen`,
  );
}

async function openDocument(): Promise<void> {
  try {
    const result = await openFilePicker();
    useDocumentStore.getState().setFileName(result.fileName);
    const canvasEl = document.querySelector("[data-canvas]");
    applyOpenedDocument(result, {
      viewportWidth: canvasEl?.clientWidth ?? window.innerWidth - 480,
      viewportHeight: canvasEl?.clientHeight ?? window.innerHeight,
    });
  } catch (err) {
    console.error("Failed to open file:", err);
  }
}

export function getFileCommands(): PaletteCommand[] {
  return [
    { id: "file-open", label: "Open…", group: "File", keywords: ["open file", "load"], run: () => void openDocument() },
    { id: "file-export-json", label: "Export as .json", group: "File", keywords: ["save", "download"], run: exportAsJson },
    { id: "file-export-pen", label: "Export as .pen", group: "File", keywords: ["save", "download"], run: exportAsPen },
  ];
}
