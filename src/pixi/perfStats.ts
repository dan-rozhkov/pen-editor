type Label = "updateCulling" | "flush";
type Bucket = { count: number; totalMs: number; maxMs: number };

const buckets = new Map<Label, Bucket>();

export const perfStats = {
  time<T>(label: Label, fn: () => T): T {
    // Dev-only instrumentation — skip the performance.now() bracketing (and
    // the bucket bookkeeping) entirely outside dev so this never costs a
    // production frame. Vitest sets import.meta.env.DEV true, so tests still
    // exercise the measured path below.
    if (!import.meta.env.DEV) return fn();
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - start;
      const b = buckets.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
      b.count += 1;
      b.totalMs += ms;
      if (ms > b.maxMs) b.maxMs = ms;
      buckets.set(label, b);
    }
  },
  summary(): Record<string, Bucket> {
    return Object.fromEntries(buckets);
  },
  reset(): void {
    buckets.clear();
  },
};
