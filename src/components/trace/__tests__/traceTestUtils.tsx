import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { vi } from "vitest";
import { sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";
import TracePage from "@/routes/TracePage";

// Shared by the trace page tests: render the page at a URL, serve the sample trace.

export function renderTrace(url = "/trace/sample-trace-1") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/trace/:id" element={<TracePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

export const answer = (response: Partial<Response>) => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));
export const serveSample = () => answer({ ok: true, status: 200, json: async () => sampleTraceJson() });
export const frameId = () => screen.getByTestId("trace-frame").getAttribute("data-frame-id");
/** The n-th (1-based) row button of the step list. */
export const stepButton = (n: number) => within(screen.getByRole("region", { name: "Steps" })).getAllByRole("button")[n - 1]!;
/** The 1-based number of the selected step, or 0 when none is. */
export const currentStep = () =>
  within(screen.getByRole("region", { name: "Steps" }))
    .getAllByRole("button")
    .findIndex((b) => b.getAttribute("aria-current") === "step") + 1;

/**
 * A manual clock for the player: requestAnimationFrame callbacks queue up and
 * `advance(ms)` runs them in 16 ms frames while performance.now() moves along.
 */
export function installFakeClock() {
  let now = 0;
  let next = 0;
  const queue = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.set(++next, cb);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  return {
    /** Runs the queued frames `frameMs` apart (a slow frame skips ahead, so long spans can use big frames). */
    advance(ms: number, frameMs = 16) {
      for (let left = ms; left > 0; left -= frameMs) {
        act(() => {
          now += Math.min(frameMs, left);
          const due = [...queue.values()];
          queue.clear();
          due.forEach((cb) => cb(now));
        });
      }
    },
    /** True while an animation frame is requested. */
    get running() {
      return queue.size > 0;
    },
  };
}
