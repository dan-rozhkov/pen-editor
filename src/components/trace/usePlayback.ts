import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSchedule, type Schedule, DEFAULT_PACE, DEFAULT_SPEED, playTimeToTraceTime, stepAtPlayTime, traceTimeToPlayTime, type PaceMode, type Speed } from "./playback";

export interface Playback {
  /** Playhead, trace time (epoch ms). */
  time: number;
  playing: boolean;
  speed: Speed;
  pace: PaceMode;
  play(): void;
  pause(): void;
  /** The pacing schedule in use. */
  schedule: Schedule;
  /**
   * Moves the playhead without calling `onTime`. Does not pause. `playTime` (ms at 1x) says where on
   * the schedule the playhead is when `time` alone is ambiguous (steps that share a start in per-step pacing).
   */
  seek(time: number, playTime?: number): void;
  setSpeed(speed: Speed): void;
  setPace(pace: PaceMode): void;
}

/**
 * A requestAnimationFrame loop over a pacing schedule. The elapsed time is
 * measured with performance.now(), so a slow frame skips ahead instead of
 * slowing the playback down. `onTime` runs on every tick with the new trace
 * time and, in per-step pacing, the step the schedule shows; it must be stable (the loop restarts when it changes).
 */
export function usePlayback(trace: BrowseTrace, onTime: (time: number, step?: number) => void): Playback {
  const [pace, setPace] = useState<PaceMode>(DEFAULT_PACE);
  const [speed, setSpeed] = useState<Speed>(DEFAULT_SPEED);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(trace.startedAt);
  const schedule = useMemo(() => buildSchedule(trace, pace), [trace, pace]);
  const timeRef = useRef(time);
  const speedRef = useRef(speed);
  /** Play position of the playhead, valid for one schedule; otherwise it is derived from the trace time. */
  const positionRef = useRef<{ schedule: Schedule; at: number } | null>(null);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const move = useCallback((next: number) => {
    timeRef.current = next;
    setTime(next);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let position = positionRef.current?.schedule === schedule ? positionRef.current.at : traceTimeToPlayTime(schedule, timeRef.current);
    const tick = () => {
      const now = performance.now();
      position += Math.max(0, now - last) * speedRef.current;
      last = now;
      positionRef.current = { schedule, at: Math.min(position, schedule.duration) };
      if (position >= schedule.duration) {
        move(schedule.traceEnd);
        onTime(schedule.traceEnd, stepAtPlayTime(schedule, schedule.duration));
        setPlaying(false);
        return;
      }
      const next = playTimeToTraceTime(schedule, position);
      move(next);
      onTime(next, stepAtPlayTime(schedule, position));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, schedule, onTime, move]);

  const play = useCallback(() => {
    if (schedule.duration <= 0) return;
    if (timeRef.current >= schedule.traceEnd) {
      move(schedule.traceStart);
      positionRef.current = { schedule, at: 0 };
      onTime(schedule.traceStart, stepAtPlayTime(schedule, 0));
    }
    setPlaying(true);
  }, [schedule, onTime, move]);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback(
    (next: number, playTime?: number) => {
      move(Math.min(schedule.traceEnd, Math.max(schedule.traceStart, next)));
      positionRef.current = playTime === undefined ? null : { schedule, at: playTime };
    },
    [schedule, move],
  );

  return { time, playing, speed, pace, schedule, play, pause, seek, setSpeed, setPace };
}
