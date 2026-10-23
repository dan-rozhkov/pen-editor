import type { UIGenerationLiveRun } from "@/vendor/uiGeneration/ui-generation.js";

/**
 * The "agent is generating this screen" pass (`src/vendor/uiGeneration/`).
 *
 * While a `batch_design` screen streams, the streaming preview hides the
 * partial html and runs a live wireframe drawing over it instead
 * (`StreamingEmbedPreviewLayer`). When the real embed node lands, the preview
 * unmounts and PARKS its run here under the screen's geometry; `EmbedHost`
 * CLAIMS it under the same geometry, moves the overlay into its own box and
 * lets the scan line reveal the finished screen. Either side may come first.
 *
 * Which embeds play it at all: `batch_design` marks every embed its `I()`
 * creates; `EmbedHost` consumes the mark once, on its first mount. A mark
 * older than `MARK_TTL_MS` is ignored, so an embed that was not on screen when
 * it landed (outline/present mode, a hidden parent) does not replay the pass
 * much later when it first becomes visible.
 *
 * Plain module maps, not a store: nothing renders from them.
 *
 * Kill switch: `localStorage pen.generationReveal=off` (the stream is shown
 * as before, and landed embeds appear without the pass).
 */

const MARK_TTL_MS = 15_000;
/** A parked run nobody claims (the stream was stopped, the node never came) is dropped after this. */
const PARK_TTL_MS = 1_500;

const marks = new Map<string, number>();
const parked = new Map<string, { run: UIGenerationLiveRun; timer: ReturnType<typeof setTimeout> }>();
const claims = new Map<string, (run: UIGenerationLiveRun) => void>();

export function isGenerationRevealEnabled(): boolean {
  try {
    return localStorage.getItem("pen.generationReveal") !== "off";
  } catch {
    return true;
  }
}

export function markEmbedForGenerationReveal(nodeId: string, now = Date.now()): void {
  for (const [id, at] of marks) if (now - at > MARK_TTL_MS) marks.delete(id);
  marks.set(nodeId, now);
}

/** True once per mark, and only while the mark is fresh and the pass is enabled. */
export function consumeEmbedGenerationReveal(nodeId: string, now = Date.now()): boolean {
  const at = marks.get(nodeId);
  if (at === undefined) return false;
  marks.delete(nodeId);
  return now - at <= MARK_TTL_MS && isGenerationRevealEnabled();
}

/** Scene-space rect of a screen, as both the streaming preview and the landed node know it. */
export function revealGeometryKey(x: number, y: number, width: number, height: number): string {
  return [x, y, width, height].map((v) => Math.round(v)).join(",");
}

/** Hand a streaming screen's live run over to whoever claims `key`. */
export function parkLiveRun(key: string, run: UIGenerationLiveRun): void {
  const claim = claims.get(key);
  if (claim) {
    claims.delete(key);
    claim(run);
    return;
  }
  const previous = parked.get(key);
  if (previous) {
    clearTimeout(previous.timer);
    previous.run.cancel();
  }
  const timer = setTimeout(() => {
    if (parked.get(key)?.run !== run) return;
    parked.delete(key);
    run.cancel();
  }, PARK_TTL_MS);
  parked.set(key, { run, timer });
}

/**
 * Take the run parked under `key`: at once if it is there, else when it is
 * parked. Returns a release function that withdraws a claim still waiting.
 */
export function claimLiveRun(key: string, onRun: (run: UIGenerationLiveRun) => void): () => void {
  const entry = parked.get(key);
  if (entry) {
    parked.delete(key);
    clearTimeout(entry.timer);
    onRun(entry.run);
    return () => {};
  }
  claims.set(key, onRun);
  return () => {
    if (claims.get(key) === onRun) claims.delete(key);
  };
}

export function __resetEmbedGenerationRevealForTests(): void {
  marks.clear();
  for (const { run, timer } of parked.values()) {
    clearTimeout(timer);
    run.cancel();
  }
  parked.clear();
  claims.clear();
}
