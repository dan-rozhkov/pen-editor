import { describe, it, expect, vi } from "vitest";
import { createSemaphore } from "../bakeSemaphore";

/** Flush pending microtasks so queued promise resolutions settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createSemaphore", () => {
  it("resolves immediately while under the concurrency limit", async () => {
    const sem = createSemaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(r1).toBeTypeOf("function");
    expect(r2).toBeTypeOf("function");
  });

  it("blocks the (max+1)th acquire until a slot is released", async () => {
    const sem = createSemaphore(1);
    const release1 = await sem.acquire();

    let acquired2 = false;
    const p2 = sem.acquire().then((release) => {
      acquired2 = true;
      return release;
    });

    await flushMicrotasks();
    expect(acquired2).toBe(false);

    release1();
    await p2;
    expect(acquired2).toBe(true);
  });

  it("grants queued acquires in FIFO order", async () => {
    const sem = createSemaphore(1);
    const release1 = await sem.acquire();

    const order: number[] = [];
    const p2 = sem.acquire().then((release) => {
      order.push(2);
      return release;
    });
    const p3 = sem.acquire().then((release) => {
      order.push(3);
      return release;
    });

    await flushMicrotasks();
    expect(order).toEqual([]);

    release1();
    const release2 = await p2;
    expect(order).toEqual([2]);

    release2();
    await p3;
    expect(order).toEqual([2, 3]);
  });

  it("never lets more than maxConcurrent holders be active at once under interleaved acquire/release", async () => {
    const max = 3;
    const sem = createSemaphore(max);
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];

    async function acquireOne(): Promise<void> {
      const release = await sem.acquire();
      active++;
      peak = Math.max(peak, active);
      releases.push(() => {
        active--;
        release();
      });
    }

    // Fire off more concurrent acquisitions than the limit allows.
    const acquisitions = Array.from({ length: 10 }, () => acquireOne());
    await flushMicrotasks();
    expect(peak).toBeLessThanOrEqual(max);
    expect(active).toBeLessThanOrEqual(max);

    // Release a couple, let more through, keep checking the invariant.
    releases.shift()?.();
    releases.shift()?.();
    await flushMicrotasks();
    expect(peak).toBeLessThanOrEqual(max);

    while (releases.length > 0) {
      releases.shift()?.();
      await flushMicrotasks();
      expect(active).toBeLessThanOrEqual(max);
    }

    await Promise.all(acquisitions);
    expect(active).toBe(0);
    expect(peak).toBeLessThanOrEqual(max);
  });

  it("is idempotent: releasing twice does not free an extra slot", async () => {
    const sem = createSemaphore(1);
    const release1 = await sem.acquire();
    release1();
    release1(); // second call must be a no-op

    const release2 = await sem.acquire();
    expect(release2).toBeTypeOf("function");

    // A third acquire should still block, proving the double-release above
    // did not leak an extra slot into the pool.
    let acquired3 = false;
    void sem.acquire().then(() => {
      acquired3 = true;
    });
    await flushMicrotasks();
    expect(acquired3).toBe(false);

    release2();
    await flushMicrotasks();
    expect(acquired3).toBe(true);
  });

  it("does not call the deferred queue callback synchronously (sanity check for vi.fn spy usage)", async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    const spy = vi.fn();
    void sem.acquire().then(spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
