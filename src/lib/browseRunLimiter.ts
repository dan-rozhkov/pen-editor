/**
 * Concurrency cap for isolated QA browse_agent runs (spec pen-editor-desktop
 * docs/superpowers/specs/2026-10-17-isolated-parallel-browse-design.md). The
 * cap is global to the page, not per chat: every run is a browser session on
 * the same shell. Runs past the cap wait in FIFO order; a waiting run whose
 * signal aborts leaves the queue and never starts.
 */
export const MAX_PARALLEL_BROWSE_RUNS = 4;

let active = 0;
const waiting: Array<{ grant: () => void }> = [];

/** A held slot. `release` is idempotent. */
export interface BrowseSlot {
  release(): void;
}

function grantSlot(): BrowseSlot {
  active += 1;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      active -= 1;
      waiting.shift()?.grant();
    },
  };
}

/**
 * Resolves with a slot, or with null when `signal` aborted first (before or
 * while waiting). The caller releases the slot when the run has FULLY finished.
 */
export function acquireBrowseSlot(signal: AbortSignal): Promise<BrowseSlot | null> {
  if (signal.aborted) return Promise.resolve(null);
  if (active < MAX_PARALLEL_BROWSE_RUNS) return Promise.resolve(grantSlot());
  return new Promise<BrowseSlot | null>((resolve) => {
    const entry = {
      grant: () => {
        signal.removeEventListener("abort", onAbort);
        resolve(grantSlot());
      },
    };
    const onAbort = () => {
      const i = waiting.indexOf(entry);
      if (i >= 0) waiting.splice(i, 1);
      resolve(null);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    waiting.push(entry);
  });
}

/** Test seam. */
export function browseRunCounts(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}
