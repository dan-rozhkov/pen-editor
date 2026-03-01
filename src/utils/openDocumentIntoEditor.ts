import type { ThemeName } from "@/types/variable";
import type { DocumentData } from "@/utils/fileUtils";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";

interface ApplyOpenedDocumentOptions {
  viewportWidth: number;
  viewportHeight: number;
}

const DEFAULT_THEME: ThemeName = "light";

export function applyOpenedDocument(
  data: DocumentData,
  options: ApplyOpenedDocumentOptions,
) {
  const themeToApply: ThemeName = data.activeTheme ?? DEFAULT_THEME;

  useSceneStore.getState().setNodes(data.nodes);
  useVariableStore.getState().setVariables(data.variables);
  useUIThemeStore.getState().setUITheme(themeToApply);

  // Opening a file should define a new baseline state:
  // no undo step back to the pre-open canvas.
  useSelectionStore.setState({
    selectedIds: [],
    editingNodeId: null,
    editingMode: null,
    instanceContext: null,
    selectedDescendantIds: [],
    enteredContainerId: null,
    lastSelectedId: null,
  });
  useHistoryStore.getState().clear();

  useViewportStore
    .getState()
    .fitToContent(data.nodes, options.viewportWidth, options.viewportHeight);
}
