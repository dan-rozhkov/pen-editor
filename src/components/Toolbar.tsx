import { useState } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useVariableStore } from "../store/variableStore";
import { useThemeStore } from "../store/themeStore";
import { useViewportStore } from "../store/viewportStore";
import { useUIThemeStore } from "../store/uiThemeStore";
import { usePixelGridStore } from "../store/pixelGridStore";
import { useRendererStore } from "../store/rendererStore";
import type { SceneNode } from "../types/scene";
import { downloadDocument, openFilePicker } from "../utils/fileUtils";
import { parsePixsoJson } from "../utils/pixsoImportUtils";
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
import {
  CaretDownIcon,
} from "@phosphor-icons/react";

export function Toolbar() {
  const nodes = useSceneStore((state) => state.getNodes());
  const setNodes = useSceneStore((state) => state.setNodes);
  const addNode = useSceneStore((state) => state.addNode);
  const variables = useVariableStore((state) => state.variables);
  const setVariables = useVariableStore((state) => state.setVariables);
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const setActiveTheme = useThemeStore((state) => state.setActiveTheme);
  const uiTheme = useUIThemeStore((s) => s.uiTheme);
  const showPixelGrid = usePixelGridStore((s) => s.showPixelGrid);
  const togglePixelGrid = usePixelGridStore((s) => s.togglePixelGrid);
  const rendererMode = useRendererStore((s) => s.rendererMode);
  const setRendererMode = useRendererStore((s) => s.setRendererMode);
  const [importOpen, setImportOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const focusViewportOnNodes = (targetNodes: SceneNode[]) => {
    const canvasEl = document.querySelector("[data-canvas]");
    const viewportWidth = canvasEl?.clientWidth ?? window.innerWidth - 480;
    const viewportHeight = canvasEl?.clientHeight ?? window.innerHeight;
    useViewportStore
      .getState()
      .fitToContent(targetNodes, viewportWidth, viewportHeight);
  };

  const handleSave = () => {
    downloadDocument(nodes, variables, activeTheme);
  };

  const handleOpen = async () => {
    try {
      const {
        nodes: loadedNodes,
        variables: loadedVariables,
        activeTheme: loadedTheme,
      } = await openFilePicker();
      setNodes(loadedNodes);
      setVariables(loadedVariables);
      setActiveTheme(loadedTheme);
      focusViewportOnNodes(loadedNodes);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const handleImport = () => {
    setError(null);
    if (!jsonText.trim()) {
      setError("Please paste JSON content");
      return;
    }
    try {
      const node = parsePixsoJson(jsonText);
      addNode(node);
      useSelectionStore.getState().select(node.id);
      focusViewportOnNodes([node]);
      setImportOpen(false);
      setJsonText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="flex flex-row items-center gap-2 px-1 py-2 bg-surface-panel border-b border-border-default">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" />}
        >
          File
          <CaretDownIcon className="size-3 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4}>
          <DropdownMenuItem onClick={handleOpen}>
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSave}>
            Save
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setImportOpen(true);
              setError(null);
            }}
          >
            Import JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Settings
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuCheckboxItem checked={uiTheme === "light"} onCheckedChange={() => useUIThemeStore.getState().setUITheme("light")}>
                Light theme
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={uiTheme === "dark"} onCheckedChange={() => useUIThemeStore.getState().setUITheme("dark")}>
                Dark theme
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={showPixelGrid} onCheckedChange={togglePixelGrid}>
                Pixel grid
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={rendererMode === "konva"} onCheckedChange={() => setRendererMode("konva")}>
                Konva
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={rendererMode === "pixi"} onCheckedChange={() => setRendererMode("pixi")}>
                Pixi
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
              className="w-full h-64 bg-secondary text-secondary-foreground rounded-md px-2 py-1.5 text-xs font-mono resize-none outline-none focus-visible:ring-1 focus-visible:ring-[#0d99ff] placeholder:text-muted-foreground"
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
