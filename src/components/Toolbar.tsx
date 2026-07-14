import { useState } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useVariableStore } from "../store/variableStore";
import { useTextStyleStore } from "../store/textStyleStore";
import { useStyleStore } from "../store/styleStore";
import { useThemeStore } from "../store/themeStore";
import { useUIThemeStore } from "../store/uiThemeStore";
import { usePixelGridStore } from "../store/pixelGridStore";
import { useGuidesStore } from "../store/guidesStore";
import { useRenderModeStore } from "../store/renderModeStore";
import { useViewportStore } from "../store/viewportStore";
import { usePageStore } from "../store/pageStore";
import { useCanvasRefStore } from "../store/canvasRefStore";
import { buildTree } from "../types/scene";

import { downloadDocument, downloadPublicPen, openFilePicker } from "../utils/fileUtils";
import { exportDesignTokens } from "../lib/commands/fileCommands";
import { useDocumentStore } from "../store/documentStore";
import { applyOpenedDocument } from "../utils/openDocumentIntoEditor";
import { parsePixsoNodes } from "../utils/pixsoImportUtils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import { TooltipShortcut } from "./ui/tooltip";
import { formatShortcut } from "../lib/commands/shortcutFormat";
import {
  CaretDownIcon,
} from "@phosphor-icons/react";

export function Toolbar() {
  const addNode = useSceneStore((state) => state.addNode);
  const variables = useVariableStore((state) => state.variables);
  const textStyles = useTextStyleStore((state) => state.textStyles);
  const fillStyles = useStyleStore((state) => state.fillStyles);
  const effectStyles = useStyleStore((state) => state.effectStyles);
  const uiTheme = useUIThemeStore((s) => s.uiTheme);
  const showPixelGrid = usePixelGridStore((s) => s.showPixelGrid);
  const togglePixelGrid = usePixelGridStore((s) => s.togglePixelGrid);
  const showRulers = useGuidesStore((s) => s.showRulers);
  const toggleShowRulers = useGuidesStore((s) => s.toggleShowRulers);
  const outlineModeActive = useRenderModeStore((s) => s.renderMode === "outline");
  const toggleRenderMode = useRenderModeStore((s) => s.toggle);
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const hasSlides = useSceneStore((state) =>
    state.rootIds.some((id) => state.nodesById[id]?.type === "frame"),
  );

  const [importOpen, setImportOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isExportingPptx, setIsExportingPptx] = useState(false);

  const handleSave = () => {
    const pageStore = usePageStore.getState();
    pageStore.saveCurrentPageState();

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
    const activeTheme = useThemeStore.getState().activeTheme;
    downloadDocument(
      pagesForExport,
      variables,
      activeTheme,
      componentArtifactsById,
      `${name}.json`,
      textStyles,
      fillStyles,
      effectStyles,
    );
  };

  const handleExportPublicPen = () => {
    const currentPageNodes = useSceneStore.getState().getNodes();
    const name = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "") || "document";
    const activeTheme = useThemeStore.getState().activeTheme;
    downloadPublicPen(currentPageNodes, variables, activeTheme, `${name}.pen`);
  };

  const handleExportPptx = async () => {
    if (!pixiRefs || !hasSlides || isExportingPptx) return;
    setIsExportingPptx(true);
    try {
      const { exportSlidesToPptx } = await import("../utils/exportPptxUtils");
      await exportSlidesToPptx(pixiRefs);
    } finally {
      setIsExportingPptx(false);
    }
  };

  const handleExportTokens = () => {
    exportDesignTokens();
  };

  const handleOpen = async () => {
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
  };

  const handleCopy = () => {
    window.dispatchEvent(new Event("pen-editor:copy"));
  };

  const handlePaste = () => {
    window.dispatchEvent(new Event("pen-editor:paste"));
  };

  const handleCopyStyle = () => {
    window.dispatchEvent(new Event("pen-editor:copy-style"));
  };

  const handlePasteStyle = () => {
    window.dispatchEvent(new Event("pen-editor:paste-style"));
  };

  const handleImport = () => {
    setError(null);
    if (!jsonText.trim()) {
      setError("Please paste JSON content");
      return;
    }
    try {
      const nodes = parsePixsoNodes(jsonText);
      if (nodes.length === 0) {
        setError("No importable nodes found in JSON");
        return;
      }
      nodes.forEach((node) => addNode(node));
      useSelectionStore.getState().setSelectedIds(nodes.map((n) => n.id));
      const canvasEl = document.querySelector("[data-canvas]");
      const viewportWidth = canvasEl?.clientWidth ?? window.innerWidth - 480;
      const viewportHeight = canvasEl?.clientHeight ?? window.innerHeight;
      useViewportStore
        .getState()
        .fitToContent(nodes, viewportWidth, viewportHeight);
      setImportOpen(false);
      setJsonText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="flex flex-row items-center gap-2 px-1 py-2 bg-surface-panel">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" />}
        >
          File
          <CaretDownIcon className="size-3 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-56">
          <DropdownMenuItem onClick={handleOpen}>
            Open
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Edit
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <DropdownMenuItem onClick={handleCopy}>
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePaste}>
                Paste
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleCopyStyle}>
                Copy properties
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePasteStyle}>
                Paste properties
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Export
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <DropdownMenuItem onClick={handleSave}>
                Export as .json
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPublicPen}>
                Export as .pen
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleExportPptx}
                disabled={!pixiRefs || !hasSlides || isExportingPptx}
              >
                {isExportingPptx ? "Exporting .pptx…" : "Export as .pptx"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportTokens}>
                Export design tokens (.tokens.json)
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Import
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <DropdownMenuItem
                onClick={() => {
                  setImportOpen(true);
                  setError(null);
                }}
              >
                Import from Pixso
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Settings
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              <DropdownMenuCheckboxItem checked={uiTheme === "light"} onCheckedChange={() => useUIThemeStore.getState().setUITheme("light")}>
                Light theme
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={uiTheme === "dark"} onCheckedChange={() => useUIThemeStore.getState().setUITheme("dark")}>
                Dark theme
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={showPixelGrid} onCheckedChange={togglePixelGrid}>
                Pixel grid
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showRulers} onCheckedChange={toggleShowRulers}>
                Rulers
                <TooltipShortcut className="ml-auto">Shift+R</TooltipShortcut>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={outlineModeActive} onCheckedChange={toggleRenderMode}>
                Outline mode
                <TooltipShortcut className="ml-auto">{formatShortcut(["mod", "shift", "O"])}</TooltipShortcut>
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent
          className="sm:max-w-xl max-h-[80vh] flex flex-col gap-0 p-0"
          showCloseButton={false}
          overlayClassName="backdrop-blur-none bg-black/40"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <DialogTitle>Import Pixso JSON</DialogTitle>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col gap-2 px-4 py-3 overflow-y-auto">
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder="Paste Pixso JSON here..."
              className="w-full h-64 bg-secondary text-secondary-foreground rounded-md px-2 py-1.5 text-xs font-mono resize-none outline-none focus-visible:ring-1 focus-visible:ring-accent-light placeholder:text-muted-foreground"
              spellCheck={false}
            />
            {error && (
              <p className="text-red-500 text-xs">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setImportOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleImport}>
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
