import { create } from "zustand";

const MIN_LOADING_MS = 300;

interface LoadingStoreState {
  isCanvasLoading: boolean;
  setCanvasLoading: (loading: boolean) => void;
  /** Set loading=true and clear after PixiJS sync completes (min 300ms) */
  showLoadingUntilRendered: () => void;
}

export const useLoadingStore = create<LoadingStoreState>((set) => {
  let loadingCounter = 0;

  return {
    isCanvasLoading: false,
    setCanvasLoading: (loading) => set({ isCanvasLoading: loading }),
    showLoadingUntilRendered: () => {
      const id = ++loadingCounter;
      set({ isCanvasLoading: true });

      const start = performance.now();

      // Wait for PixiJS to finish rendering (2 rAF frames)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const elapsed = performance.now() - start;
          const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

          setTimeout(() => {
            // Only clear if no newer loading request was made
            if (loadingCounter === id) {
              set({ isCanvasLoading: false });
            }
          }, remaining);
        });
      });
    },
  };
});
