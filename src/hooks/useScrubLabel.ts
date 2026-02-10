import { useRef, useEffect, useCallback } from "react";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";

interface UseScrubLabelOptions {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

export function useScrubLabel({
  value,
  onChange,
  step = 1,
  min,
  max,
}: UseScrubLabelOptions) {
  const startXRef = useRef(0);
  const startValueRef = useRef(0);
  const isDraggingRef = useRef(false);

  // Keep onChange/step/min/max in refs so mousemove closure always sees latest
  const onChangeRef = useRef(onChange);
  const stepRef = useRef(step);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  onChangeRef.current = onChange;
  stepRef.current = step;
  minRef.current = min;
  maxRef.current = max;

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const deltaX = e.clientX - startXRef.current;
    let newValue = startValueRef.current + Math.round(deltaX) * stepRef.current;
    if (minRef.current !== undefined) newValue = Math.max(minRef.current, newValue);
    if (maxRef.current !== undefined) newValue = Math.min(maxRef.current, newValue);
    onChangeRef.current(newValue);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    useHistoryStore.getState().endBatch();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only left button
      if (e.button !== 0) return;
      e.preventDefault();

      startXRef.current = e.clientX;
      startValueRef.current = value;
      isDraggingRef.current = true;

      const history = useHistoryStore.getState();
      history.saveHistory(createSnapshot(useSceneStore.getState()));
      history.startBatch();

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [value, handleMouseMove, handleMouseUp]
  );

  // Cleanup on unmount if mid-drag
  useEffect(() => {
    return () => {
      if (isDraggingRef.current) {
        useHistoryStore.getState().endBatch();
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  return {
    onMouseDown,
    style: { cursor: "ew-resize" as const },
  };
}
