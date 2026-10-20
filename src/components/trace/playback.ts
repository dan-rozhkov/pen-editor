import type { BrowseTrace, BrowseTraceFrame, BrowseTraceStep } from "@sideform/browser-agent/agent/session";
import { lastFrameOfStep, traceEnd } from "./traceModel";

// Pure time mapping of the trace player: no React, no DOM, no clock.
//
// Two clocks exist. "Trace time" is epoch ms, as recorded (`startedAt`, `at`).
// "Play time" is ms of playback at 1x speed, from 0 to `Schedule.duration`;
// the player multiplies the elapsed wall time by the speed to move along it.
// A schedule is a list of contiguous segments, each mapping a slice of play
// time linearly onto a slice of trace time. Two pacing modes build them:
//   realtime: the trace timeline as it ran, but a stretch with no step start
//             and no frame that is longer than MAX_IDLE_GAP_MS plays in
//             MAX_IDLE_GAP_MS.
//   step:     every step gets STEP_PLAY_MS, whatever its real duration.

export type PaceMode = "realtime" | "step";

export const PACE_MODES: readonly PaceMode[] = ["realtime", "step"];
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 1;
export const DEFAULT_PACE: PaceMode = "realtime";

/** An idle stretch (no step start, no frame) longer than this is played in this long. */
export const MAX_IDLE_GAP_MS = 3000;
/** Play time of one step in "step" pacing. */
export const STEP_PLAY_MS = 1500;

export interface Segment {
  playStart: number;
  playEnd: number;
  traceStart: number;
  traceEnd: number;
  /** "step" pacing only: the step this segment belongs to. */
  stepIndex?: number;
}

export interface Schedule {
  mode: PaceMode;
  /** Trace time of the first and the last moment (epoch ms). */
  traceStart: number;
  traceEnd: number;
  /** Play time of the whole trace, ms at 1x. */
  duration: number;
  segments: Segment[];
}

/** Steps in start order (stable for equal times). */
export function sortedSteps(trace: BrowseTrace): BrowseTraceStep[] {
  return [...trace.steps].sort((a, b) => a.startedAt - b.startedAt || a.index - b.index);
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function realtimeSegments(trace: BrowseTrace, start: number, end: number): Segment[] {
  const marks = [start, end, ...trace.steps.map((s) => s.startedAt), ...trace.frames.map((f) => f.at)].map((t) => clamp(t, start, end));
  const unique = [...new Set(marks)].sort((a, b) => a - b);
  const segments: Segment[] = [];
  let play = 0;
  for (let i = 1; i < unique.length; i++) {
    const from = unique[i - 1]!;
    const to = unique[i]!;
    const length = Math.min(to - from, MAX_IDLE_GAP_MS);
    segments.push({ playStart: play, playEnd: play + length, traceStart: from, traceEnd: to });
    play += length;
  }
  return segments;
}

function stepSegments(trace: BrowseTrace, start: number, end: number): Segment[] {
  const steps = sortedSteps(trace);
  return steps.map((step, i) => {
    // A step plays from its start to the next step's start. The first one also
    // carries the lead-in before it, the last one the tail after it.
    const from = i === 0 ? start : clamp(step.startedAt, start, end);
    const to = i === steps.length - 1 ? end : clamp(steps[i + 1]!.startedAt, from, end);
    return { playStart: i * STEP_PLAY_MS, playEnd: (i + 1) * STEP_PLAY_MS, traceStart: from, traceEnd: to, stepIndex: step.index };
  });
}

export function buildSchedule(trace: BrowseTrace, mode: PaceMode): Schedule {
  const traceStart = trace.startedAt;
  const end = traceEnd(trace);
  // A trace without steps has nothing to pace by step: play it as it ran.
  const segments = mode === "step" && trace.steps.length > 0 ? stepSegments(trace, traceStart, end) : realtimeSegments(trace, traceStart, end);
  return { mode, traceStart, traceEnd: end, duration: segments.length > 0 ? segments[segments.length - 1]!.playEnd : 0, segments };
}

/** The trace time shown at a play time (clamped to the schedule). */
export function playTimeToTraceTime(schedule: Schedule, playTime: number): number {
  const { segments } = schedule;
  if (segments.length === 0) return schedule.traceStart;
  const at = clamp(playTime, 0, schedule.duration);
  const seg = segments.find((s) => at < s.playEnd) ?? segments[segments.length - 1]!;
  const length = seg.playEnd - seg.playStart;
  if (length <= 0) return seg.traceStart;
  return seg.traceStart + ((at - seg.playStart) / length) * (seg.traceEnd - seg.traceStart);
}

/** The play time at which a trace time is shown (clamped to the schedule); the inverse of the above. */
export function traceTimeToPlayTime(schedule: Schedule, traceTime: number): number {
  const { segments } = schedule;
  if (segments.length === 0) return 0;
  const at = clamp(traceTime, schedule.traceStart, schedule.traceEnd);
  const seg = segments.find((s) => at < s.traceEnd);
  if (!seg) return schedule.duration;
  const length = seg.traceEnd - seg.traceStart;
  if (length <= 0) return seg.playStart;
  return seg.playStart + ((at - seg.traceStart) / length) * (seg.playEnd - seg.playStart);
}

/**
 * The step running at a trace time: the latest one that has started. Before the
 * first start it is the first step (the viewer always has one selected).
 * `steps` must be in start order (`sortedSteps`). Returns the step's `index`.
 */
export function stepAtTraceTime(steps: BrowseTraceStep[], traceTime: number): number | undefined {
  let found = steps[0];
  for (const step of steps) {
    if (step.startedAt > traceTime) break;
    found = step;
  }
  return found?.index;
}

/**
 * The frame on screen at a trace time: the latest one with `at <= t`. Before the
 * first frame it is the first frame. `frames` must be in time order (`sortedFrames`).
 */
export function frameAtTraceTime(frames: BrowseTraceFrame[], traceTime: number): BrowseTraceFrame | undefined {
  let found = frames[0];
  for (const frame of frames) {
    if (frame.at > traceTime) break;
    found = frame;
  }
  return found;
}

/**
 * The step a "step" schedule is showing at a play time (the segment that contains it), so a step
 * of no length, or one that starts with another, still gets its turn. `undefined` for a real-time schedule.
 */
export function stepAtPlayTime(schedule: Schedule, playTime: number): number | undefined {
  if (schedule.mode !== "step" || schedule.segments.length === 0) return undefined;
  const at = clamp(playTime, 0, schedule.duration);
  return (schedule.segments.find((s) => at < s.playEnd) ?? schedule.segments[schedule.segments.length - 1]!).stepIndex;
}

/**
 * Where the playhead goes when a step is chosen by hand: the time of the frame shown for the step, so
 * that Play does not jump to another frame; else the step's end, else its start. A candidate counts
 * only if `stepAtTraceTime` gives the same step back there.
 */
export function playheadOfStep(trace: BrowseTrace, ordered: BrowseTraceStep[], stepIndex: number): number | undefined {
  const step = trace.steps.find((s) => s.index === stepIndex);
  if (!step) return undefined;
  const frame = lastFrameOfStep(trace, stepIndex);
  const candidates = [...(frame ? [frame.at] : []), step.endedAt, step.startedAt];
  return candidates.find((t) => stepAtTraceTime(ordered, t) === stepIndex) ?? step.startedAt;
}
