/**
 * FIFO async semaphore. Browsers cap live WebGL contexts (~16 in Chromium);
 * an offscreen shader bake mounts one for its whole render+capture lifetime,
 * and nothing else in this codebase bounds how many bakes can run at once.
 * Under a resize storm (many bakes queued in quick succession) that cap can
 * be exhausted — after which `getContext('webgl')` fails silently and does
 * NOT self-heal, so every subsequent bake permanently returns null. Routing
 * all bakes through one shared semaphore keeps concurrent contexts well
 * under the cap regardless of how many nodes/resizes are in flight.
 */
export function createSemaphore(maxConcurrent: number): { acquire(): Promise<() => void> } {
  let active = 0;
  const queue: Array<() => void> = [];

  function makeRelease(): () => void {
    let released = false;
    return () => {
      // Idempotent: a caller that accidentally releases twice (e.g. once in a
      // `finally` and once in an error path) must not free an extra slot.
      if (released) return;
      released = true;
      active--;
      const next = queue.shift();
      if (next) {
        active++;
        next();
      }
    };
  }

  function acquire(): Promise<() => void> {
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve(makeRelease());
    }
    return new Promise((resolve) => {
      queue.push(() => resolve(makeRelease()));
    });
  }

  return { acquire };
}
