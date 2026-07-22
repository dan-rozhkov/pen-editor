// Manual double-click detection.
//
// Browsers only dispatch a native "dblclick" event when a click train's
// `detail` is exactly 2 — rapid clicking keeps incrementing `detail`
// (1,2,3,4…) instead of resetting, so clicks 3+4 of a fast four-click burst
// never produce a second "dblclick". This helper replaces that reliance:
// every call to `registerClick` is a "click" (already filtered upstream to
// exclude drags/marquee/resize), and any two consecutive qualifying clicks
// within the time/distance thresholds count as a pair — regardless of how
// many clicks came before.

export interface ClickPoint {
  x: number;
  y: number;
  time: number;
}

export interface DoubleClickDetectorOptions {
  /** Max time between the two clicks of a pair, in ms. */
  timeThresholdMs: number;
  /** Max screen-space distance between the two clicks, in px. */
  distanceThreshold: number;
}

export interface DoubleClickDetector {
  /**
   * Register a qualifying click. Returns true if it completes a double-click
   * pair with the previously registered click, and resets the tracker so the
   * next click starts a fresh pair. Returns false otherwise, storing this
   * click as the new "first click" of a potential pair.
   */
  registerClick(point: ClickPoint): boolean;
  /** Discard any pending "first click" (e.g. after a non-qualifying gesture). */
  reset(): void;
}

export function createDoubleClickDetector(
  options: DoubleClickDetectorOptions,
): DoubleClickDetector {
  const { timeThresholdMs, distanceThreshold } = options;

  let lastClick: ClickPoint | null = null;

  return {
    registerClick(point: ClickPoint): boolean {
      if (
        lastClick &&
        point.time - lastClick.time <= timeThresholdMs &&
        Math.abs(point.x - lastClick.x) <= distanceThreshold &&
        Math.abs(point.y - lastClick.y) <= distanceThreshold
      ) {
        lastClick = null;
        return true;
      }
      lastClick = point;
      return false;
    },
    reset(): void {
      lastClick = null;
    },
  };
}
