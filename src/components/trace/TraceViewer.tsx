import type { BrowseTrace, BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Filmstrip } from "./Filmstrip";
import { FrameView } from "./FrameView";
import { Inspector } from "./Inspector";
import { frameAtTraceTime, playheadOfStep, sortedSteps, stepAtPlayTime, stepAtTraceTime, traceTimeToPlayTime } from "./playback";
import { usePlayback } from "./usePlayback";
import { StepList } from "./StepList";
import { TraceHeader } from "./TraceHeader";
import {
  buildStepRows,
  framesOfStep,
  pickStepFrame,
  sortedFrames,
  stepFromParam,
  stepLinkUrl,
  stepOfFrame,
  stepsWithProblems,
  type FrameSide,
} from "./traceModel";

/** Keys the playhead slider handles itself; the rest (Space) go to the page. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Keys that belong to the widget in focus (tabs and menus use the arrows, fields use everything). */
function ownsKeys(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="tablist"], [role="dialog"], [role="menu"], [role^="menuitem"], input, textarea, select, [contenteditable="true"]')) return true;
  return SLIDER_KEYS.has(key) && !!target.closest('[role="slider"]');
}

/** Controls that Space presses: it must not also toggle playback. Navigation buttons (`data-space-plays`) do not count. */
function pressedBySpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.closest("[data-space-plays]")) return false;
  return !!target.closest('button, a[href], summary, [role="menu"], [role^="menuitem"], [role="button"], [role="tab"], [role="switch"], [role="checkbox"]');
}

const DETAILS_KEY = "pen.trace.detailsOpen";

/** Whether the details panel shows, remembered per viewer; open by default. */
function useDetailsOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(DETAILS_KEY, String(next));
    } catch {
      // The choice just will not outlive this page.
    }
  }, [open]);
  return [open, toggle];
}

interface ViewerProps {
  trace: BrowseTrace;
  /** The raw `?step=` value (1-based): the step to open on. */
  initialStep?: string | null;
  /** Keep `?step=` in the address bar in step with the selection. Off for a file opened in memory. */
  deepLink?: boolean;
}

/** Writes `?step=N` into the address without a navigation: the router and the trace loader never see it. */
function writeStepToUrl(stepIndex: number): void {
  window.history.replaceState(window.history.state, "", stepLinkUrl(window.location, stepIndex));
}

export function TraceViewer({ trace, initialStep, deepLink = true }: ViewerProps) {
  const rows = useMemo(() => buildStepRows(trace), [trace]);
  const flagged = useMemo(() => stepsWithProblems(trace), [trace]);
  const frames = useMemo(() => sortedFrames(trace), [trace]);
  const linked = useMemo(() => (deepLink ? stepFromParam(initialStep ?? null, trace) : undefined), [deepLink, initialStep, trace]);
  const [stepIndex, setStepIndex] = useState<number | null>(linked ?? trace.steps[0]?.index ?? null);
  const [frameId, setFrameId] = useState<number | null>(null);
  // Before / After is per step: another step starts on After again.
  const [side, setSide] = useState<{ step: number | null; view: FrameSide }>({ step: null, view: "after" });
  const [detailsOpen, toggleDetails] = useDetailsOpen();

  // A frame picked on the filmstrip or by playback shows as it is; a step's own frames get the Before / After switch.
  const stepPick = useMemo(() => {
    if (frameId !== null || stepIndex === null) return null;
    return pickStepFrame(framesOfStep(trace, stepIndex), side.step === stepIndex ? side.view : "after");
  }, [trace, frameId, stepIndex, side]);
  const shown = useMemo(() => {
    if (frameId !== null) return frames.find((f) => f.id === frameId);
    return stepPick ? stepPick.frame : frames[0];
  }, [frames, frameId, stepPick]);

  const position = useMemo(() => {
    const at = shown ? frames.findIndex((f) => f.id === shown.id) : -1;
    return at >= 0 ? { index: at, total: frames.length } : null;
  }, [shown, frames]);
  const ordered = useMemo(() => sortedSteps(trace), [trace]);
  // Playback drives the selection: the step running at the playhead and the frame on screen then.
  const followTime = useCallback(
    (time: number, scheduled?: number) => {
      // Per-step pacing names the step itself; real time reads it off the clock.
      const running = scheduled ?? stepAtTraceTime(ordered, time);
      if (running !== undefined) setStepIndex(running);
      setFrameId(frameAtTraceTime(frames, time)?.id ?? null);
    },
    [ordered, frames],
  );
  const { pause, seek, play, setSpeed, setPace, schedule, ...player } = usePlayback(trace, followTime);

  const togglePlay = useCallback(() => {
    if (player.playing) {
      pause();
      return;
    }
    play();
  }, [player.playing, pause, play]);
  // Per-step pacing names the step by play time, so steps that share a start stay separate.
  const perStep = schedule.mode === "step";
  // Every manual choice stops playback and puts the playhead on what was chosen.
  const selectStep = useCallback(
    (index: number) => {
      pause();
      const own = perStep ? schedule.segments.find((seg) => seg.stepIndex === index) : undefined;
      if (own) seek(own.traceStart, own.playStart);
      else {
        const at = playheadOfStep(trace, ordered, index);
        if (at !== undefined) seek(at);
      }
      setStepIndex(index);
      setFrameId(null);
    },
    [trace, ordered, pause, seek, perStep, schedule],
  );
  const selectFrame = useCallback(
    (frame: BrowseTraceFrame) => {
      pause();
      seek(frame.at);
      // The step the clock shows at the frame's time: what playback would pick there, so Play does not jump.
      const running = (perStep ? stepAtPlayTime(schedule, traceTimeToPlayTime(schedule, frame.at)) : undefined) ?? stepAtTraceTime(ordered, frame.at) ?? stepOfFrame(trace, frame);
      if (running !== undefined) setStepIndex(running);
      setFrameId(frame.id);
    },
    [trace, ordered, pause, seek, perStep, schedule],
  );
  const seekTo = useCallback(
    (time: number) => {
      pause();
      seek(time);
      followTime(time, perStep ? stepAtPlayTime(schedule, traceTimeToPlayTime(schedule, time)) : undefined);
    },
    [pause, seek, followTime, perStep, schedule],
  );

  // Open on the linked step with the playhead there too.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || linked === undefined) return;
    opened.current = true;
    const at = playheadOfStep(trace, ordered, linked);
    if (at !== undefined) seek(at);
  }, [linked, trace, ordered, seek]);

  const firstStep = useRef(trace.steps[0]?.index ?? null);
  useEffect(() => {
    if (!deepLink || stepIndex === null) return;
    // Leave a plain address alone until the viewer moves off the first step.
    if (stepIndex === firstStep.current && !new URL(window.location.href).searchParams.has("step")) return;
    writeStepToUrl(stepIndex);
  }, [deepLink, stepIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || ownsKeys(e.target, e.key)) return;
      if (e.key === " ") {
        if (pressedBySpace(e.target)) return;
        e.preventDefault();
        if (!e.repeat) togglePlay();
        return;
      }
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
    };
    // A navigation button would press itself on Space release, selecting its step again.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && e.target instanceof HTMLElement && e.target.closest("[data-space-plays]")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [trace, stepIndex, selectStep, togglePlay]);

  return (
    <div className="flex h-dvh flex-col bg-surface-panel text-text-primary">
      <TraceHeader trace={trace} detailsOpen={detailsOpen} onToggleDetails={toggleDetails} />
      <Filmstrip
        trace={trace}
        selectedFrameId={shown?.id}
        selectedStep={stepIndex}
        flagged={flagged}
        onSelectFrame={selectFrame}
        onSelectStep={selectStep}
        player={{
          time: player.time,
          playing: player.playing,
          speed: player.speed,
          pace: player.pace,
          onTogglePlay: togglePlay,
          onSeek: seekTo,
          onSpeedChange: setSpeed,
          onPaceChange: setPace,
        }}
      />
      {/* Steps and the frame side by side; the details panel runs full width under them. Under 900px all stack. */}
      <main
        className={
          "grid min-h-0 flex-1 auto-rows-max grid-cols-1 overflow-y-auto " +
          "min-[900px]:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] min-[900px]:grid-rows-[minmax(0,1fr)] min-[900px]:overflow-hidden"
        }
      >
        <div className="order-2 max-h-96 min-h-0 border-t border-border-default min-[900px]:order-none min-[900px]:max-h-none min-[900px]:border-e min-[900px]:border-t-0 flex flex-col">
          <StepList rows={rows} selected={stepIndex} flagged={flagged} onSelect={selectStep} />
        </div>
        <div className="order-1 flex min-h-0 flex-col min-[900px]:order-none">
          <FrameView
            frame={shown}
            startedAt={trace.startedAt}
            position={position}
            kind={stepPick?.kind}
            compare={
              stepPick?.canCompare && stepIndex !== null
                ? { view: stepPick.kind === "before" ? "before" : "after", onChange: (view) => setSide({ step: stepIndex, view }) }
                : undefined
            }
          />
        </div>
      </main>
      {/* Hidden, not unmounted: the selected tab and the scroll position survive. */}
      <div hidden={!detailsOpen} className={cn("h-60 min-[900px]:h-72 min-h-0 min-w-0 shrink-0 flex-col border-t border-border-default", detailsOpen && "flex")}>
        <Inspector trace={trace} selectedStep={stepIndex} onSelectStep={selectStep} canLink={deepLink} />
      </div>
    </div>
  );
}
