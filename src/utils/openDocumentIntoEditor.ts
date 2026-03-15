import type { ThemeName } from "@/types/variable";
import type { DocumentData } from "@/utils/fileUtils";
import { flattenTree } from "@/types/scene";
import { useHistoryStore } from "@/store/historyStore";
import { useLoadingStore } from "@/store/loadingStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { usePageStore } from "@/store/pageStore";
import type { PageData } from "@/store/pageStore";

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

  // Show loading overlay immediately
  useLoadingStore.getState().setCanvasLoading(true);

  // Convert document pages into PageData format (flat storage)
  const pageDataList: PageData[] = data.pages.map((page) => {
    const flat = flattenTree(page.nodes);
    return {
      id: page.id,
      name: page.name,
      nodesById: flat.nodesById,
      parentById: flat.parentById,
      childrenById: flat.childrenById,
      rootIds: flat.rootIds,
      pageBackground: page.pageBackground,
      expandedFrameIds: new Set<string>(),
      viewport: { scale: 1, x: 0, y: 0 },
      history: { past: [], future: [] },
    };
  });

  // Set up shared state
  useVariableStore.getState().setVariables(data.variables);
  useUIThemeStore.getState().setUITheme(themeToApply);

  // Clear selection and history before page init
  useSelectionStore.setState({
    selectedIds: [],
    editingNodeId: null,
    editingMode: null,
    enteredContainerId: null,
    lastSelectedId: null,
  });
  useHistoryStore.getState().clear();

  // Initialize pageStore with all pages (this also loads the first page into sceneStore)
  usePageStore
    .getState()
    .initFromDocument(pageDataList, data.componentArtifacts ?? {});

  // Fit viewport to first page content
  const firstPageNodes = data.pages[0]?.nodes ?? [];
  useViewportStore
    .getState()
    .fitToContent(firstPageNodes, options.viewportWidth, options.viewportHeight);
}
