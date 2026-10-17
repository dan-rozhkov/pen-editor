import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { saveShareCredentials } from "@/lib/shareCanvas";
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
    useTextStyleStore.getState().setTextStyles([]);
    useUIThemeStore.getState().setUITheme("light");
    useHistoryStore.getState().clear();
    useSelectionStore.getState().clearSelection();
    // A brand-new document has no relationship to whatever share link was
    // active for the previous one.
    saveShareCredentials(null);

    return JSON.stringify({ success: true, message: "New document created" });
  }

  // File path — not supported in client-only mode
  return JSON.stringify({
    error: "Opening files by path is not supported in client-only mode. Use 'new' to create a new document.",
  });
};
