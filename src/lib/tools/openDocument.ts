import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import type { ToolHandler } from "../toolRegistry";

export const openDocument: ToolHandler = async (args) => {
  const filePathOrTemplate = args.filePathOrTemplate as string | undefined;

  if (!filePathOrTemplate) {
    return JSON.stringify({ error: "filePathOrTemplate is required" });
  }

  if (filePathOrTemplate === "new") {
    // Clear all state for a new document
    useSceneStore.getState().clearNodes();
    useVariableStore.getState().setVariables([]);
    useUIThemeStore.getState().setUITheme("light");
    useHistoryStore.getState().clear();
    useSelectionStore.getState().clearSelection();

    return JSON.stringify({ success: true, message: "New document created" });
  }

  // File path — not supported in client-only mode
  return JSON.stringify({
    error: "Opening files by path is not supported in client-only mode. Use 'new' to create a new document.",
  });
};
