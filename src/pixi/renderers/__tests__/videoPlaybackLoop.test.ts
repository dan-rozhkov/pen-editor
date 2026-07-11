import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../renderScheduler", () => ({
  requestCanvasRender: vi.fn(),
}));

import { requestCanvasRender } from "../../renderScheduler";
import { videoPlaybackStarted, videoPlaybackStopped, getPlayingVideoCount } from "../videoPlaybackLoop";

const requestCanvasRenderMock = vi.mocked(requestCanvasRender);

/**
 * Covers the fix for BUG-02 (video fill playback throttled to the ~1s
 * renderScheduler safety tick): while at least one video is playing, a rAF
 * loop must keep calling `requestCanvasRender()` every frame, and must stop
 * itself once the last playing video pauses/tears down.
 */
describe("videoPlaybackLoop", () => {
  let rafCallbacks: Array<() => void>;

  function flushRaf(): void {
    const callbacks = rafCallbacks.splice(0);
    for (const cb of callbacks) cb();
  }

  beforeEach(() => {
    rafCallbacks = [];
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCallbacks.push(cb);
      return nextId++;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    requestCanvasRenderMock.mockClear();
  });

  afterEach(() => {
    // Drain any leftover playing-video state so tests don't bleed into each
    // other via the module-level counter/rafId.
    while (getPlayingVideoCount() > 0) videoPlaybackStopped();
    flushRaf();
    vi.unstubAllGlobals();
  });

  it("starts the rAF loop on the first playing video", () => {
    videoPlaybackStarted();
    expect(rafCallbacks.length).toBe(1);
  });

  it("does not start a second loop while a video is already playing", () => {
    videoPlaybackStarted();
    videoPlaybackStarted();
    expect(rafCallbacks.length).toBe(1);
  });

  it("requests a canvas render every frame while a video is playing", () => {
    videoPlaybackStarted();
    flushRaf();
    expect(requestCanvasRenderMock).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.length).toBe(1); // self-rescheduled

    flushRaf();
    expect(requestCanvasRenderMock).toHaveBeenCalledTimes(2);
  });

  it("stops the loop once the last playing video pauses", () => {
    videoPlaybackStarted();
    flushRaf(); // consumes the first tick, reschedules

    videoPlaybackStopped();
    requestCanvasRenderMock.mockClear();
    flushRaf(); // the already-scheduled tick sees count 0 and stops

    expect(rafCallbacks.length).toBe(0);
    expect(requestCanvasRenderMock).not.toHaveBeenCalled();
  });

  it("keeps the loop alive while at least one of several videos is still playing", () => {
    videoPlaybackStarted();
    videoPlaybackStarted();
    flushRaf();

    videoPlaybackStopped();
    requestCanvasRenderMock.mockClear();
    flushRaf();

    expect(rafCallbacks.length).toBe(1);
    expect(requestCanvasRenderMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an extra stop call beyond the number of starts", () => {
    videoPlaybackStarted();
    videoPlaybackStopped();
    videoPlaybackStopped();
    expect(getPlayingVideoCount()).toBe(0);
  });

  it("skips the render call while the document is hidden but keeps the loop scheduled", () => {
    const hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    videoPlaybackStarted();
    flushRaf();

    expect(requestCanvasRenderMock).not.toHaveBeenCalled();
    expect(rafCallbacks.length).toBe(1); // still alive, resumes once visible

    hiddenSpy.mockRestore();
  });
});
