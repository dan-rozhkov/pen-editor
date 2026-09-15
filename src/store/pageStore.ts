import { create } from "zustand";
import type {
  FlatSceneNode,
  HistorySnapshot,
} from "../types/scene";
import { generateId, buildTree } from "../types/scene";
import { loadGoogleFontsFromNodes } from "../utils/fontUtils";
import { useSceneStore } from "./sceneStore";
import { useHistoryStore } from "./historyStore";
import { useLoadingStore } from "./loadingStore";
import { useViewportStore } from "./viewportStore";
import { useSelectionStore } from "./selectionStore";
import { useGuidesStore, type Guide } from "./guidesStore";
import { useMeasurementsStore, type PersistedMeasurement } from "./measurementsStore";
import { useCommentsStore, type CommentThread } from "./commentsStore";

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
  // Per-page ruler guides
  guides: Guide[];
  // Per-page frame/embed slide (presentation) order — see src/utils/slideOrder.ts
  slideOrder: string[];
  // Per-page pinned distance measurements
  measurements: PersistedMeasurement[];
  // Per-page canvas comment threads (cmt-01). Outside undo/redo.
  comments: CommentThread[];
}

interface PageStoreState {
  pages: PageData[];
  activePageId: string;

  addPage: (name?: string) => string;
  deletePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  duplicatePage: (pageId: string) => string;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  switchToPage: (pageId: string) => void;
  saveCurrentPageState: () => void;
  initFromDocument: (pages: PageData[]) => void;
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
    guides: [],
    slideOrder: [],
    measurements: [],
    comments: [],
  };
}

const defaultPage = createEmptyPage("Page 1");

export const usePageStore = create<PageStoreState>((set, get) => ({
  pages: [defaultPage],
  activePageId: defaultPage.id,

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
      guides: sourceAfterSave.guides.map((g) => ({ ...g })),
      slideOrder: [...sourceAfterSave.slideOrder],
      measurements: sourceAfterSave.measurements.map((m) => ({ ...m })),
      comments: sourceAfterSave.comments.map((c) => ({ ...c })),
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
    const { activePageId, pages } = get();
    const pageIndex = pages.findIndex((p) => p.id === activePageId);
    if (pageIndex < 0) return;

    const scene = useSceneStore.getState();
    const viewport = useViewportStore.getState();
    const history = useHistoryStore.getState();

    const updatedPages = [...pages];
    updatedPages[pageIndex] = {
      ...updatedPages[pageIndex],
      nodesById: { ...scene.nodesById },
      parentById: { ...scene.parentById },
      childrenById: { ...scene.childrenById },
      rootIds: [...scene.rootIds],
      pageBackground: scene.pageBackground,
      expandedFrameIds: new Set(scene.expandedFrameIds),
      viewport: { scale: viewport.scale, x: viewport.x, y: viewport.y },
      history: history.getStacks(),
      guides: useGuidesStore.getState().guides,
      slideOrder: [...scene.slideOrder],
      measurements: useMeasurementsStore.getState().measurements,
      comments: useCommentsStore.getState().threads,
    };

    set({ pages: updatedPages });
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

    // Load into sceneStore
    useSceneStore.setState({
      nodesById: { ...targetPage.nodesById },
      parentById: { ...targetPage.parentById },
      childrenById: { ...targetPage.childrenById },
      rootIds: [...targetPage.rootIds],
      pageBackground: targetPage.pageBackground,
      expandedFrameIds: new Set(targetPage.expandedFrameIds),
      slideOrder: [...targetPage.slideOrder],
      _cachedTree: null,
    });

    // Load Google Fonts for this page's nodes
    const tree = buildTree(
      targetPage.rootIds,
      targetPage.nodesById,
      targetPage.childrenById,
    );
    loadGoogleFontsFromNodes(tree);

    // Load viewport
    useViewportStore.getState().setViewportState(targetPage.viewport);

    // Load history
    useHistoryStore.getState().setStacks(targetPage.history);

    // Load ruler guides
    useGuidesStore.getState().setGuides(targetPage.guides);

    // Load pinned measurements
    useMeasurementsStore.getState().setMeasurements(targetPage.measurements);

    // Load canvas comment threads (also drop any in-progress pin draft — it
    // belongs to the page we're leaving).
    useCommentsStore.getState().setThreads(targetPage.comments);
    useCommentsStore.getState().cancelDraft();

    // Clear selection
    useSelectionStore.setState({
      selectedIds: [],
      editingNodeId: null,
      editingMode: null,
      enteredContainerId: null,
      lastSelectedId: null,
      activeEmbedId: null,
    });

    set({ activePageId: pageId });

    // Show loading overlay until PixiJS finishes rendering
    useLoadingStore.getState().showLoadingUntilRendered();
  },

  initFromDocument: (pages: PageData[]) => {
    if (pages.length === 0) return;
    set({
      pages,
      activePageId: "",
    });

    // Switch to the first page (this loads it into sceneStore)
    get().switchToPage(pages[0].id);
  },
}));
