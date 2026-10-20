import type { BrowseTrace, BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Filmstrip } from "./Filmstrip";
import { FrameView, type FrameMode } from "./FrameView";
import { Inspector } from "./Inspector";
import { StepList } from "./StepList";
import { TraceHeader } from "./TraceHeader";
import { beforeFrameOfStep, buildStepRows, lastFrameOfStep, sortedFrames, stepOfFrame, stepsWithProblems } from "./traceModel";

/** Keys that belong to the widget in focus (tabs use the arrows, fields use everything). */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('[role="tablist"], input, textarea, select, [contenteditable="true"]');
}

export function TraceViewer({ trace }: { trace: BrowseTrace }) {
  const rows = useMemo(() => buildStepRows(trace), [trace]);
  const flagged = useMemo(() => stepsWithProblems(trace), [trace]);
  const frames = useMemo(() => sortedFrames(trace), [trace]);
  const [stepIndex, setStepIndex] = useState<number | null>(trace.steps[0]?.index ?? null);
  const [frameId, setFrameId] = useState<number | null>(null);
  const [mode, setMode] = useState<FrameMode>("after");

  const step = trace.steps.find((s) => s.index === stepIndex);
  const afterFrame = useMemo(() => {
    if (frameId !== null) return frames.find((f) => f.id === frameId);
    return stepIndex === null ? frames[0] : lastFrameOfStep(trace, stepIndex);
  }, [frames, frameId, stepIndex, trace]);
  const beforeFrame = useMemo(() => (stepIndex === null ? undefined : beforeFrameOfStep(trace, stepIndex)), [stepIndex, trace]);
  const shown = mode === "before" && step ? beforeFrame : afterFrame;

  const selectStep = useCallback((index: number) => {
    setStepIndex(index);
    setFrameId(null);
  }, []);
  const selectFrame = useCallback(
    (frame: BrowseTraceFrame) => {
      const owner = stepOfFrame(trace, frame);
      if (owner !== undefined) setStepIndex(owner);
      setFrameId(frame.id);
      setMode("after");
    },
    [trace],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || ownsKeys(e.target)) return;
      const position = trace.steps.findIndex((s) => s.index === stepIndex);
      const go = (next: number) => {
        const target = trace.steps[Math.min(trace.steps.length - 1, Math.max(0, next))];
        if (target) selectStep(target.index);
        e.preventDefault();
      };
      if (e.key === "ArrowLeft") go(position < 0 ? 0 : position - 1);
      else if (e.key === "ArrowRight") go(position + 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(trace.steps.length - 1);
      else if ((e.key === "b" || e.key === "B") && step) {
        setMode((m) => (m === "after" ? "before" : "after"));
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trace, stepIndex, step, selectStep]);

  const shownIndex = shown ? frames.findIndex((f) => f.id === shown.id) : -1;
  return (
    <div className="flex h-dvh flex-col bg-surface-base text-text-primary">
      <TraceHeader trace={trace} />
      <Filmstrip
        trace={trace}
        selectedFrameId={afterFrame?.id}
        selectedStep={stepIndex}
        flagged={flagged}
        onSelectFrame={selectFrame}
        onSelectStep={selectStep}
      />
      {/* Steps and the frame side by side; the details panel runs full width under them. Under 900px all stack. */}
      <main
        className={
          "grid min-h-0 flex-1 grid-cols-1 overflow-y-auto " +
          "min-[900px]:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] min-[900px]:grid-rows-[minmax(0,1fr)] min-[900px]:overflow-hidden"
        }
      >
        <div className="order-2 max-h-96 min-h-0 border-t border-border-default min-[900px]:order-none min-[900px]:max-h-none min-[900px]:border-e min-[900px]:border-t-0 flex flex-col">
          <StepList rows={rows} selected={stepIndex} flagged={flagged} onSelect={selectStep} />
        </div>
        <div className="order-1 flex min-h-0 flex-col min-[900px]:order-none">
          <FrameView
            mode={mode}
            onModeChange={setMode}
            frame={shown}
            startedAt={trace.startedAt}
            position={shownIndex >= 0 ? { index: shownIndex, total: frames.length } : null}
            hasStep={!!step}
          />
        </div>
      </main>
      <div className="flex h-72 min-h-0 min-w-0 shrink-0 flex-col border-t border-border-default">
        <Inspector trace={trace} selectedStep={stepIndex} onSelectStep={selectStep} />
      </div>
    </div>
  );
}
