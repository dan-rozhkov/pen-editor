import { useEffect } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { usePageStore } from "@/store/pageStore";
import { useDragStore } from "@/store/dragStore";
import { isApplyingLintFix, useLintStore } from "@/store/lintStore";

/** Wait this long after the last change before checking again. */
export const LINT_IDLE_MS = 1500;

/**
 * Re-checks the design when it has been idle for `LINT_IDLE_MS`: any change
 * to the scene, tokens, mode or page restarts the timer, and a check never
 * starts while a pointer is held or a layer is being dragged (it waits for
 * the next idle moment instead).
 */
export function useLintAutoRun(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pressed = false;
    const run = () => {
      timer = undefined;
      if (pressed || useDragStore.getState().isDragging) {
        schedule();
        return;
      }
      useLintStore.getState().run({ auto: true });
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(run, LINT_IDLE_MS);
    };
    const down = () => {
      pressed = true;
    };
    const up = () => {
      pressed = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    const unsubs = [
      useSceneStore.subscribe((s, prev) => {
        if (isApplyingLintFix()) return;
        if (s.nodesById !== prev.nodesById || s.pageBackground !== prev.pageBackground) schedule();
      }),
      useVariableStore.subscribe(schedule),
      useThemeStore.subscribe((s, prev) => {
        if (s.modeContext !== prev.modeContext) schedule();
      }),
      usePageStore.subscribe((s, prev) => {
        if (s.activePageId !== prev.activePageId || s.pages !== prev.pages) schedule();
      }),
    ];
    useLintStore.getState().run({ auto: true });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      for (const u of unsubs) u();
    };
  }, []);
}
