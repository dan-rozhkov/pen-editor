import { useSceneStore } from "../store/sceneStore";
import { useVariableStore } from "../store/variableStore";
import { useThemeStore } from "../store/themeStore";
import { downloadDocument, openFilePicker } from "../utils/fileUtils";
import { Button } from "./ui/button";

export function Toolbar() {
  const nodes = useSceneStore((state) => state.nodes);
  const setNodes = useSceneStore((state) => state.setNodes);
  const variables = useVariableStore((state) => state.variables);
  const setVariables = useVariableStore((state) => state.setVariables);
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const setActiveTheme = useThemeStore((state) => state.setActiveTheme);

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

  return (
    <div className="flex flex-row items-center gap-2 px-3 py-2 bg-surface-panel border-b border-border-default h-[44px]">
      <Button variant="secondary" size="sm" onClick={handleOpen}>
        Open
      </Button>
      <Button variant="secondary" size="sm" onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}
