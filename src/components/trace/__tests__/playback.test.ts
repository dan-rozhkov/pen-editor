import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { describe, expect, it } from "vitest";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import {
  buildSchedule,
  frameAtTraceTime,
  MAX_IDLE_GAP_MS,
  playheadOfStep,
  playTimeToTraceTime,
  stepAtPlayTime,
  sortedSteps,
  stepAtTraceTime,
  STEP_PLAY_MS,
  traceTimeToPlayTime,
} from "../playback";
import { sortedFrames, traceEnd } from "../traceModel";

const T0 = sampleTrace.startedAt;

/** A trace of `[start, end]` offsets for steps and `at` offsets for frames, ending at `end`. */
function mini(steps: [number, number][], frames: number[] = [], end = 0): BrowseTrace {
  const last = Math.max(end, ...steps.map(([, e]) => e), ...frames);
  return {
    ...sampleTrace,
    startedAt: T0,
    endedAt: T0 + last,
    steps: steps.map(([s, e], index) => ({ index, tool: "browse_act", args: {}, startedAt: T0 + s, endedAt: T0 + e, ok: true })),
    frames: frames.map((at, id) => ({ id, at: T0 + at, kind: "step" as const, src: "data:image/png;base64,AA" })),
    console: [],
    network: [],
  };
}

describe("buildSchedule: real time", () => {
  it("plays a trace without long gaps at its own length", () => {
    const schedule = buildSchedule(mini([[0, 500], [600, 1200]], [700], 1500), "realtime");
    expect(schedule.duration).toBe(1500);
    expect(schedule.traceStart).toBe(T0);
    expect(schedule.traceEnd).toBe(T0 + 1500);
  });

  it("compresses a stretch with no step start and no frame to 3 s", () => {
    // 10 s of nothing between the step start at 1 s and the frame at 11 s.
    const schedule = buildSchedule(mini([[1000, 1500]], [11_000], 12_000), "realtime");
    expect(schedule.duration).toBe(1000 + MAX_IDLE_GAP_MS + 1000);
    const gap = schedule.segments.find((s) => s.traceEnd - s.traceStart === 10_000)!;
    expect(gap.playEnd - gap.playStart).toBe(MAX_IDLE_GAP_MS);
  });

  it("does not compress a gap of exactly 3 s", () => {
    expect(buildSchedule(mini([[0, 100]], [3000]), "realtime").duration).toBe(3000);
  });

  it("keeps segments contiguous in play time and in trace time", () => {
    const { segments } = buildSchedule(sampleTrace, "realtime");
    segments.slice(1).forEach((seg, i) => {
      expect(seg.playStart).toBe(segments[i]!.playEnd);
      expect(seg.traceStart).toBe(segments[i]!.traceEnd);
    });
    // The sample has one 3.55 s stretch (the failing click): it plays in 3 s.
    expect(buildSchedule(sampleTrace, "realtime").duration).toBe(9000 - 550);
  });

  it("is empty for a trace of no length", () => {
    const empty = buildSchedule(mini([], [], 0), "realtime");
    expect(empty.segments).toEqual([]);
    expect(empty.duration).toBe(0);
    expect(playTimeToTraceTime(empty, 500)).toBe(T0);
    expect(traceTimeToPlayTime(empty, T0 + 500)).toBe(0);
  });

  it("handles a single step", () => {
    const schedule = buildSchedule(mini([[0, 800]]), "realtime");
    expect(schedule.duration).toBe(800);
    expect(playTimeToTraceTime(schedule, 400)).toBe(T0 + 400);
  });
});

describe("buildSchedule: per step", () => {
  const trace = mini([[200, 900], [5000, 5200], [20_000, 20_100]], [], 21_000);
  const schedule = buildSchedule(trace, "step");

  it("gives every step the same play time", () => {
    expect(schedule.duration).toBe(3 * STEP_PLAY_MS);
    expect(schedule.segments.map((s) => [s.playStart, s.playEnd, s.stepIndex])).toEqual([
      [0, 1500, 0],
      [1500, 3000, 1],
      [3000, 4500, 2],
    ]);
  });

  it("covers the lead-in with the first step and the tail with the last", () => {
    expect(schedule.segments[0]!.traceStart).toBe(T0);
    expect(schedule.segments[0]!.traceEnd).toBe(T0 + 5000);
    expect(schedule.segments[2]!.traceEnd).toBe(T0 + 21_000);
  });

  it("maps linearly inside a step", () => {
    expect(playTimeToTraceTime(schedule, 750)).toBe(T0 + 2500);
    expect(traceTimeToPlayTime(schedule, T0 + 5000 + 7500)).toBe(1500 + 750);
  });

  it("falls back to real time when there are no steps", () => {
    const bare = buildSchedule(mini([], [500], 1000), "step");
    expect(bare.mode).toBe("step");
    expect(bare.duration).toBe(1000);
  });

  it("handles a single step", () => {
    const one = buildSchedule(mini([[0, 90_000]]), "step");
    expect(one.duration).toBe(STEP_PLAY_MS);
    expect(playTimeToTraceTime(one, STEP_PLAY_MS / 2)).toBe(T0 + 45_000);
  });
});

describe("time mapping", () => {
  const schedule = buildSchedule(sampleTrace, "realtime");

  it("clamps outside the schedule", () => {
    expect(playTimeToTraceTime(schedule, -50)).toBe(schedule.traceStart);
    expect(playTimeToTraceTime(schedule, schedule.duration + 1e6)).toBe(schedule.traceEnd);
    expect(traceTimeToPlayTime(schedule, T0 - 1e6)).toBe(0);
    expect(traceTimeToPlayTime(schedule, schedule.traceEnd + 1e6)).toBe(schedule.duration);
  });

  it("hits the boundaries exactly", () => {
    expect(playTimeToTraceTime(schedule, 0)).toBe(T0);
    expect(playTimeToTraceTime(schedule, schedule.duration)).toBe(T0 + 9000);
    expect(traceTimeToPlayTime(schedule, T0 + 9000)).toBe(schedule.duration);
  });

  it("round-trips through both pacing modes", () => {
    for (const mode of ["realtime", "step"] as const) {
      const s = buildSchedule(sampleTrace, mode);
      for (const offset of [0, 200, 1234, 4100, 5000, 7650, 8999, 9000]) {
        const back = playTimeToTraceTime(s, traceTimeToPlayTime(s, T0 + offset));
        expect(back).toBeCloseTo(T0 + offset, 6);
      }
    }
  });

  it("is monotonic", () => {
    let last = -1;
    for (let p = 0; p <= schedule.duration; p += 37) {
      const t = playTimeToTraceTime(schedule, p);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });

  it("skips a step that starts at the same time as another", () => {
    const twins = buildSchedule(mini([[0, 100], [0, 100], [1000, 1100]]), "step");
    expect(traceTimeToPlayTime(twins, T0)).toBe(STEP_PLAY_MS);
    expect(playTimeToTraceTime(twins, 100)).toBe(T0);
  });
});

describe("stepAtTraceTime", () => {
  const steps = sortedSteps(sampleTrace);

  it("picks the latest step that has started", () => {
    expect(stepAtTraceTime(steps, T0 + 2000)).toBe(1);
    expect(stepAtTraceTime(steps, T0 + 2299)).toBe(1);
    expect(stepAtTraceTime(steps, T0 + 2300)).toBe(2);
    expect(stepAtTraceTime(steps, T0 + 1e6)).toBe(7);
  });

  it("is the first step before any step started", () => {
    expect(stepAtTraceTime(steps, T0)).toBe(0);
  });

  it("is undefined for a trace without steps", () => {
    expect(stepAtTraceTime([], T0)).toBeUndefined();
  });

  it("sorts steps recorded out of order", () => {
    const trace = mini([[500, 600], [0, 100]]);
    expect(sortedSteps(trace).map((s) => s.index)).toEqual([1, 0]);
  });
});

describe("frameAtTraceTime", () => {
  const frames = sortedFrames(sampleTrace);

  it("picks the latest frame at or before the time", () => {
    expect(frameAtTraceTime(frames, T0 + 3150)?.id).toBe(1);
    expect(frameAtTraceTime(frames, T0 + 3949)?.id).toBe(1);
    expect(frameAtTraceTime(frames, T0 + 1e6)?.id).toBe(5);
  });

  it("is the first frame before the first one", () => {
    expect(frameAtTraceTime(frames, T0)?.id).toBe(0);
  });

  it("is undefined without frames", () => {
    expect(frameAtTraceTime([], T0)).toBeUndefined();
  });
});

describe("traceEnd", () => {
  it("is the latest of the end, the frames and the steps", () => {
    expect(traceEnd(sampleTrace)).toBe(T0 + 9000);
    expect(traceEnd({ ...mini([[0, 100]], [5000]), endedAt: T0 + 10 })).toBe(T0 + 5000);
  });
});

describe("stepAtPlayTime", () => {
  it("names the step of the segment at the play time, twins included", () => {
    const twins = buildSchedule(mini([[0, 100], [0, 100], [1000, 1100]]), "step");
    expect([0, 1499, 1500, 2999, 3000, 9999].map((p) => stepAtPlayTime(twins, p))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("is undefined in real time and for an empty schedule", () => {
    expect(stepAtPlayTime(buildSchedule(sampleTrace, "realtime"), 500)).toBeUndefined();
    expect(stepAtPlayTime(buildSchedule(mini([], [], 0), "step"), 0)).toBeUndefined();
  });
});

describe("playheadOfStep", () => {
  const ordered = sortedSteps(sampleTrace);

  it("is the time of the frame shown for the step", () => {
    expect(playheadOfStep(sampleTrace, ordered, 4)).toBe(T0 + 7650);
    expect(playheadOfStep(sampleTrace, ordered, 0)).toBe(T0 + 1950);
  });

  it("falls back to the end of a step without frames, and to the start when nothing maps back", () => {
    expect(playheadOfStep(sampleTrace, ordered, 1)).toBe(T0 + 2150); // snapshot: the only frame is from the previous step
    const late = mini([[0, 100], [200, 300]], [250]); // a frame of step 0 stamped after step 1 began
    late.frames[0]!.stepIndex = 0;
    expect(playheadOfStep(late, sortedSteps(late), 0)).toBe(T0 + 100);
    const twins = mini([[0, 100], [0, 100]]);
    expect(playheadOfStep(twins, sortedSteps(twins), 0)).toBe(T0);
  });

  it("is undefined for an unknown step", () => {
    expect(playheadOfStep(sampleTrace, ordered, 99)).toBeUndefined();
  });
});
