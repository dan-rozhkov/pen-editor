import { useState } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useVariableStore } from "../store/variableStore";
import { useThemeStore } from "../store/themeStore";
import { useViewportStore } from "../store/viewportStore";
import type { SceneNode } from "../types/scene";
import { downloadDocument, openFilePicker } from "../utils/fileUtils";
import { parsePixsoJson } from "../utils/pixsoImportUtils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function Toolbar() {
  const nodes = useSceneStore((state) => state.getNodes());
  const setNodes = useSceneStore((state) => state.setNodes);
  const addNode = useSceneStore((state) => state.addNode);
  const variables = useVariableStore((state) => state.variables);
  const setVariables = useVariableStore((state) => state.setVariables);
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const setActiveTheme = useThemeStore((state) => state.setActiveTheme);
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
    <div className="flex flex-row items-center gap-2 px-3 py-2 bg-surface-panel border-b border-border-default h-[44px]">
      <Button variant="secondary" size="sm" onClick={handleOpen}>
        Open
      </Button>
      <Button variant="secondary" size="sm" onClick={handleSave}>
        Save
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setImportOpen(true);
          setError(null);
        }}
      >
        Import JSON
      </Button>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import Pixso JSON</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 px-6 pb-2">
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder="Paste Pixso JSON here..."
              className="w-full h-64 rounded-md border border-border-default bg-surface-input p-3 text-xs font-mono text-text-primary resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
            {error && (
              <p className="text-red-500 text-xs">{error}</p>
            )}
          </div>
          <DialogFooter className="px-6 pb-4">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
