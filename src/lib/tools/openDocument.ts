import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { useHistoryStore } from "@/store/historyStore";
import { useDocumentStore } from "@/store/documentStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { makeThemeCollection } from "@/lib/variables";
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
    // Collections too, or the previous document's leak into the new one.
    useVariableStore.getState().replaceAll([], [makeThemeCollection()]);
    useTextStyleStore.getState().setTextStyles([]);
    useDesignSystemScopeStore.getState().setScopes([]);
    useUIThemeStore.getState().setUITheme("light");
    useHistoryStore.getState().clear();
    useSelectionStore.getState().clearSelection();
    // A brand-new document has no relationship to whatever share link was
    // active for the previous one.
    saveShareCredentials(null);
    // Nor to the previous document's identity, library pins or authorship.
    useDocumentStore.getState().setLibraryState({});

    return JSON.stringify({ success: true, message: "New document created" });
  }

  // File path — not supported in client-only mode
  return JSON.stringify({
    error: "Opening files by path is not supported in client-only mode. Use 'new' to create a new document.",
  });
};
