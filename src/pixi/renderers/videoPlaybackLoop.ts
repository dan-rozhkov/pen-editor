import { requestCanvasRender } from "../renderScheduler";

/**
 * Continuous repaint loop for playing video fills.
 *
 * `renderScheduler.ts` repaints the canvas only on an explicit invalidation
 * signal or a ~1s safety tick — correct for a mostly-static design canvas,
 * but a playing `<video>` fill decodes new frames into its GPU texture every
 * render (`VideoSource({ updateFPS: 0 })`, see `videoFillHelpers.ts`)
 * *without* ever calling `requestCanvasRender()`, so playback only visibly
 * advances once a second (BUG-02).
 *
 * This module tracks how many video fills are currently playing (via
 * `videoPlaybackStarted`/`videoPlaybackStopped`, called from the native
 * `play`/`pause` element events in `videoFillHelpers.ts`) and, while that
 * count is > 0, runs a rAF loop calling `requestCanvasRender()` every frame —
 * mirroring the rafId-guarded-restart pattern used by
 * `autoLayoutDragAnimator.ts`. The loop stops itself as soon as the count
 * drops to zero, so the render-on-demand/battery-saving behavior is
 * preserved whenever no video is playing.
 *
 * YouTube fills never create a `<video>` element (they render a static
 * thumbnail — see `videoFillHelpers.ts`'s module doc comment), so they never
 * call `videoPlaybackStarted` and never keep this loop alive.
 */

let playingCount = 0;
let rafId: number | null = null;

function tick(): void {
  if (playingCount <= 0) {
    rafId = null;
    return;
  }
  // A hidden tab still receives (throttled) rAF callbacks in some browsers —
  // skip the render request while hidden so no work happens off-screen; the
  // loop stays alive and resumes full-rate renders once the tab is visible.
  if (typeof document === "undefined" || !document.hidden) {
    requestCanvasRender();
  }
  rafId = requestAnimationFrame(tick);
}

/**
 * Register a video as actively playing. Starts the repaint loop on the
 * first playing video; a no-op (beyond the counter) while it is already
 * running for another video.
 */
export function videoPlaybackStarted(): void {
  playingCount++;
  if (rafId === null) {
    rafId = requestAnimationFrame(tick);
  }
}

/**
 * Unregister a playing video. The loop notices on its next tick once the
 * count reaches zero and stops rescheduling itself. Safe to call without a
 * matching start (clamped at zero) — e.g. defensive teardown calls.
 */
export function videoPlaybackStopped(): void {
  if (playingCount > 0) playingCount--;
}

/** Test-only accessor for the current playing-video count. */
export function getPlayingVideoCount(): number {
  return playingCount;
}
