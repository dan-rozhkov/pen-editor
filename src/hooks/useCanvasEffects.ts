import { useEffect, type RefObject } from "react";
import { useMeasureStore } from "@/store/measureStore";

/**
 * FPS counter for dev mode. Measures frame rate using requestAnimationFrame.
 */
export function useFpsCounter(setFps: (fps: number | null) => void) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let rafId = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames += 1;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Tracks container resize and updates dimensions state.
 */
export function useCanvasResize(
  containerRef: RefObject<HTMLDivElement | null>,
  setDimensions: (dims: { width: number; height: number }) => void,
) {
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Tracks Alt/Option modifier key for distance measurement overlay.
 */
export function useAltKeyMeasurement() {
  useEffect(() => {
    const { setModifierHeld, clearLines } = useMeasureStore.getState();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setModifierHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setModifierHeld(false);
        clearLines();
      }
    };
    const handleBlur = () => {
      setModifierHeld(false);
      clearLines();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);
}
