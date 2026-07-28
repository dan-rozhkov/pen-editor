// The card frame is a fixed 390:844 phone ratio, but the feed also contains
// screenshots of pages whose content ran taller than one phone frame — the
// generated pipeline's height isn't capped to the frame, so a busy screen
// captures at whatever height its content actually reached. Plain
// `object-cover object-top` silently clips the bottom off those: the worst
// live case is a 750x2082 "Reports & Analytics" screen, which loses 22% of
// its height. This is a portfolio — showing the whole screen smaller beats
// showing a cropped one, so a screen whose own ratio diverges materially
// from the frame is fitted whole (`object-contain`, letterboxed) instead.
const FRAME_RATIO = 390 / 844;

// Below this, treat the mismatch as capture-size rounding noise rather than
// a genuinely taller screen: the two real capture sizes (780x1688 hand-run
// vs 750x1624 generated pipeline) round to very slightly different ratios,
// and letterboxing either of those would add visible gutters for a crop
// nobody would ever notice.
const MAX_TOLERABLE_CLIP_FRACTION = 0.02;

export type ScreenFit = "cover" | "contain";

/**
 * Decides how a screenshot of the given natural size should be fitted into
 * the fixed 390:844 card frame. `cover` keeps today's crop-to-fill behaviour;
 * `contain` letterboxes the whole image instead of cutting off its bottom.
 *
 * `width`/`height` come straight from the API and can be 0, missing,
 * negative, or otherwise non-finite on old rows — any such input falls back
 * to `cover` rather than producing NaN math or letterboxing everything.
 */
export function getScreenFit(width: number, height: number): ScreenFit {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "cover";
  }
  const screenRatio = width / height;
  // Fraction of the image's height that plain object-cover would crop to
  // make it cover the frame — derived from the two ratios (see module
  // comment for the derivation and the real numbers it produces).
  const clippedFraction = 1 - screenRatio / FRAME_RATIO;
  return clippedFraction > MAX_TOLERABLE_CLIP_FRACTION ? "contain" : "cover";
}
