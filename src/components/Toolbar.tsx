import { useRef, useState } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useVariableStore } from "../store/variableStore";
import { useThemeStore } from "../store/themeStore";
import { useViewportStore } from "../store/viewportStore";
import { downloadDocument, openFilePicker } from "../utils/fileUtils";
import { parseSvgToNodes } from "../utils/svgUtils";
import { VariablesDialog } from "./VariablesPanel";
import { Button } from "./ui/button";

export function Toolbar() {
  const nodes = useSceneStore((state) => state.nodes);
  const setNodes = useSceneStore((state) => state.setNodes);
  const addNode = useSceneStore((state) => state.addNode);
  const variables = useVariableStore((state) => state.variables);
  const setVariables = useVariableStore((state) => state.setVariables);
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const setActiveTheme = useThemeStore((state) => state.setActiveTheme);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const svgInputRef = useRef<HTMLInputElement>(null);

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
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const handleInsertSvg = () => {
    svgInputRef.current?.click();
  };

  const handleSvgFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const svgText = reader.result as string;
      const result = parseSvgToNodes(svgText);
      if (!result) {
        console.error("No paths found in SVG file");
        return;
      }

      // Place the node at the center of the current viewport
      const { x: vpX, y: vpY, scale } = useViewportStore.getState();
      const viewportCenterX = (-vpX + window.innerWidth / 2) / scale;
      const viewportCenterY = (-vpY + window.innerHeight / 2) / scale;

      result.node.x = viewportCenterX - result.node.width / 2;
      result.node.y = viewportCenterY - result.node.height / 2;

      addNode(result.node);
      useSelectionStore.getState().select(result.node.id);
    };
    reader.readAsText(file);

    // Reset input so the same file can be selected again
    e.target.value = "";
  };

  return (
    <div className="flex flex-row items-center gap-2 px-3 py-2 bg-surface-panel border-b border-border-default h-[44px]">
      <Button variant="secondary" size="sm" onClick={handleOpen}>
        Open
      </Button>
      <Button variant="secondary" size="sm" onClick={handleSave}>
        Save
      </Button>
      <Button variant="secondary" size="sm" onClick={handleInsertSvg}>
        Insert SVG
      </Button>
      <input
        ref={svgInputRef}
        type="file"
        accept=".svg"
        className="hidden"
        onChange={handleSvgFileChange}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setVariablesOpen(true)}
      >
        Variables
      </Button>
      <VariablesDialog open={variablesOpen} onOpenChange={setVariablesOpen} />
    </div>
  );
}
