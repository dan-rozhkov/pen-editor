import { create } from "zustand";
import type {
  FlatSceneNode,
  FlatFrameNode,
  HistorySnapshot,
  ComponentArtifact,
} from "../types/scene";
import { generateId, buildTree } from "../types/scene";
import { loadGoogleFontsFromNodes } from "../utils/fontUtils";
import { useSceneStore } from "./sceneStore";
import { useHistoryStore } from "./historyStore";
import { useLoadingStore } from "./loadingStore";
import { useViewportStore } from "./viewportStore";
import { useSelectionStore } from "./selectionStore";

export interface PageData {
  id: string;
  name: string;
  // Scene state snapshot
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  pageBackground: string;
  expandedFrameIds: Set<string>;
  // Per-page viewport
  viewport: { scale: number; x: number; y: number };
  // Per-page history stacks
  history: { past: HistorySnapshot[]; future: HistorySnapshot[] };
}

interface PageStoreState {
  pages: PageData[];
  activePageId: string;
  componentArtifactsById: Record<string, ComponentArtifact>;
  _injectedComponentIds: Set<string>;

  addPage: (name?: string) => string;
  deletePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  duplicatePage: (pageId: string) => string;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  switchToPage: (pageId: string) => void;
  saveCurrentPageState: () => void;
  initFromDocument: (
    pages: PageData[],
    componentArtifacts: Record<string, ComponentArtifact>,
  ) => void;
  getAllComponents: () => FlatFrameNode[];
}

function createEmptyPage(name: string): PageData {
  return {
    id: generateId(),
    name,
    nodesById: {},
    parentById: {},
    childrenById: {},
    rootIds: [],
    pageBackground: "#f5f5f5",
    expandedFrameIds: new Set<string>(),
    viewport: { scale: 1, x: 0, y: 0 },
    history: { past: [], future: [] },
  };
}

/** Collect a component and all its descendants from flat storage */
function collectSubtreeIds(
  rootId: string,
  childrenById: Record<string, string[]>,
): string[] {
  const ids: string[] = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    const children = childrenById[id];
    if (children) {
      for (const childId of children) {
        ids.push(childId);
        queue.push(childId);
      }
    }
  }
  return ids;
}

const defaultPage = createEmptyPage("Page 1");

export const usePageStore = create<PageStoreState>((set, get) => ({
  pages: [defaultPage],
  activePageId: defaultPage.id,
  componentArtifactsById: {},
  _injectedComponentIds: new Set<string>(),

  addPage: (name?: string) => {
    get().saveCurrentPageState();

    const currentPages = get().pages;
    const pageName =
      name || `Page ${currentPages.length + 1}`;
    const newPage = createEmptyPage(pageName);

    set({ pages: [...currentPages, newPage] });

    // Switch to the new page
    get().switchToPage(newPage.id);
    return newPage.id;
  },

  deletePage: (pageId: string) => {
    const { pages, activePageId } = get();
    if (pages.length <= 1) return;

    const index = pages.findIndex((p) => p.id === pageId);
    if (index < 0) return;

    const newPages = pages.filter((p) => p.id !== pageId);

    if (activePageId === pageId) {
      // Switch to adjacent page
      const nextIndex = Math.min(index, newPages.length - 1);
      set({ pages: newPages });
      get().switchToPage(newPages[nextIndex].id);
    } else {
      set({ pages: newPages });
    }
  },

  renamePage: (pageId: string, name: string) => {
    set((state) => ({
      pages: state.pages.map((p) =>
        p.id === pageId ? { ...p, name } : p,
      ),
    }));
  },

  duplicatePage: (pageId: string) => {
    const state = get();
    const sourcePage = state.pages.find((p) => p.id === pageId);
    if (!sourcePage) return "";

    state.saveCurrentPageState();

    // Re-read after save
    const currentPages = get().pages;
    const sourceAfterSave =
      currentPages.find((p) => p.id === pageId) || sourcePage;

    const newId = generateId();
    const newPage: PageData = {
      ...sourceAfterSave,
      id: newId,
      name: `${sourceAfterSave.name} copy`,
      nodesById: { ...sourceAfterSave.nodesById },
      parentById: { ...sourceAfterSave.parentById },
      childrenById: { ...sourceAfterSave.childrenById },
      rootIds: [...sourceAfterSave.rootIds],
      expandedFrameIds: new Set(sourceAfterSave.expandedFrameIds),
      viewport: { ...sourceAfterSave.viewport },
      history: { past: [], future: [] },
    };

    const sourceIndex = currentPages.findIndex((p) => p.id === pageId);
    const newPages = [...currentPages];
    newPages.splice(sourceIndex + 1, 0, newPage);
    set({ pages: newPages });

    get().switchToPage(newId);
    return newId;
  },

  reorderPages: (fromIndex: number, toIndex: number) => {
    set((state) => {
      const newPages = [...state.pages];
      const [removed] = newPages.splice(fromIndex, 1);
      newPages.splice(toIndex, 0, removed);
      return { pages: newPages };
    });
  },

  saveCurrentPageState: () => {
    const { activePageId, pages, _injectedComponentIds } = get();
    const pageIndex = pages.findIndex((p) => p.id === activePageId);
    if (pageIndex < 0) return;

    const scene = useSceneStore.getState();
    const viewport = useViewportStore.getState();
    const history = useHistoryStore.getState();

    // Strip injected cross-page component IDs from scene data
    const nodesById = { ...scene.nodesById };
    const parentById = { ...scene.parentById };
    const childrenById = { ...scene.childrenById };
    for (const id of _injectedComponentIds) {
      delete nodesById[id];
      delete parentById[id];
      delete childrenById[id];
    }

    const updatedPages = [...pages];
    updatedPages[pageIndex] = {
      ...updatedPages[pageIndex],
      nodesById,
      parentById,
      childrenById,
      rootIds: [...scene.rootIds],
      pageBackground: scene.pageBackground,
      expandedFrameIds: new Set(scene.expandedFrameIds),
      viewport: { scale: viewport.scale, x: viewport.x, y: viewport.y },
      history: history.getStacks(),
    };

    // Sync componentArtifactsById from sceneStore
    set({
      pages: updatedPages,
      componentArtifactsById: { ...scene.componentArtifactsById },
    });
  },

  switchToPage: (pageId: string) => {
    const state = get();
    if (pageId === state.activePageId && state.pages.length > 0) return;

    // Save current page state (if we have an active page)
    if (state.activePageId && state.pages.some((p) => p.id === state.activePageId)) {
      state.saveCurrentPageState();
    }

    const freshState = get();
    const targetPage = freshState.pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    // Inject cross-page component subtrees
    const injectedIds = new Set<string>();
    const nodesById = { ...targetPage.nodesById };
    const parentById = { ...targetPage.parentById };
    const childrenById = { ...targetPage.childrenById };

    for (const page of freshState.pages) {
      if (page.id === pageId) continue;
      for (const [id, node] of Object.entries(page.nodesById)) {
        if (
          node.type === "frame" &&
          (node as FlatFrameNode).reusable
        ) {
          // This is a reusable component on another page — inject its subtree
          // so that instances (RefNodes) on the target page can resolve it.
          const subtreeIds = collectSubtreeIds(id, page.childrenById);
          for (const sid of subtreeIds) {
            if (!(sid in nodesById)) {
              nodesById[sid] = page.nodesById[sid];
              parentById[sid] =
                sid === id ? null : page.parentById[sid];
              if (page.childrenById[sid]) {
                childrenById[sid] = page.childrenById[sid];
              }
              injectedIds.add(sid);
            }
          }
        }
      }
    }

    // Load into sceneStore
    useSceneStore.setState({
      nodesById,
      parentById,
      childrenById,
      rootIds: [...targetPage.rootIds],
      pageBackground: targetPage.pageBackground,
      expandedFrameIds: new Set(targetPage.expandedFrameIds),
      componentArtifactsById: { ...freshState.componentArtifactsById },
      _cachedTree: null,
    });

    // Load Google Fonts for this page's nodes
    const tree = buildTree(
      targetPage.rootIds,
      nodesById,
      childrenById,
    );
    loadGoogleFontsFromNodes(tree);

    // Load viewport
    useViewportStore.getState().setViewportState(targetPage.viewport);

    // Load history
    useHistoryStore.getState().setStacks(targetPage.history);

    // Clear selection
    useSelectionStore.setState({
      selectedIds: [],
      editingNodeId: null,
      editingMode: null,
      editingInstanceId: null,
      instanceContext: null,
      enteredContainerId: null,
      enteredInstanceDescendantPath: null,
      lastSelectedId: null,
    });

    set({
      activePageId: pageId,
      _injectedComponentIds: injectedIds,
    });

    // Show loading overlay until PixiJS finishes rendering
    useLoadingStore.getState().showLoadingUntilRendered();
  },

  initFromDocument: (
    pages: PageData[],
    componentArtifacts: Record<string, ComponentArtifact>,
  ) => {
    if (pages.length === 0) return;
    set({
      pages,
      activePageId: "",
      componentArtifactsById: componentArtifacts,
      _injectedComponentIds: new Set<string>(),
    });

    // Switch to the first page (this loads it into sceneStore)
    get().switchToPage(pages[0].id);
  },

  getAllComponents: () => {
    const { pages } = get();
    const components: FlatFrameNode[] = [];
    for (const page of pages) {
      for (const node of Object.values(page.nodesById)) {
        if (node.type === "frame" && (node as FlatFrameNode).reusable) {
          components.push(node as FlatFrameNode);
        }
      }
    }
    return components;
  },
}));
