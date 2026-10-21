import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleTraceJson } from "../__fixtures__/sampleTrace";
import { answer, currentStep, frameId, installFakeClock, renderTrace, serveSample, stepButton } from "./traceTestUtils";

// Playback of the sample trace (9 s long; steps start at 0.2, 2.0, 2.3, 3.3, 4.1, 7.8, 8.4, 8.8 s).
// In real time the 3.55 s stretch before the frame at 7.65 s plays in 3 s, so play time = trace time up to 4.1 s.

let clock: ReturnType<typeof installFakeClock>;
/** The sample with steps 2 and 3 (indexes 1 and 2) starting at the same moment. */
const twinTrace = () => {
  const trace = sampleTraceJson() as { steps: { startedAt: number }[] };
  trace.steps[1]!.startedAt = trace.steps[2]!.startedAt;
  return trace;
};
const playButton = () => screen.getByRole("button", { name: /^(Play|Pause)$/ });
const isPlaying = () => playButton().getAttribute("aria-label") === "Pause";
const menuButton = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}:`) });
const choice = (title: string) => menuButton(title).textContent;
const choose = async (title: string, name: string) => {
  fireEvent.click(menuButton(title));
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
};
const slider = () => screen.getByRole("slider", { name: "Playhead" });

async function openTrace() {
  renderTrace();
  await screen.findByTestId("trace-frame");
}

describe("trace playback", () => {
  beforeEach(() => {
    serveSample();
    clock = installFakeClock();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the play button on a gray fill in both states", async () => {
    await openTrace();
    for (const label of ["Play", "Pause"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.className).toContain("bg-secondary");
      expect(button.className).toContain("hover:bg-secondary/80");
      fireEvent.click(button);
    }
  });

  it("starts paused at 1x in real time, with the time readout", async () => {
    await openTrace();
    expect(isPlaying()).toBe(false);
    expect(choice("Speed")).toBe("1×");
    expect(choice("Pace")).toBe("Real time");
    expect(screen.getByTestId("playback-time").textContent).toBe("0:00.0 / 0:09.0");
  });

  it("advances the selected step, the frame and the readout while playing", async () => {
    await openTrace();
    fireEvent.click(playButton());
    expect(isPlaying()).toBe(true);
    clock.advance(2100);
    expect(currentStep()).toBe(2); // step 1 starts at 2.0 s
    expect(frameId()).toBe("0");
    expect(screen.getByTestId("playback-time").textContent).toBe("0:02.1 / 0:09.0");
    expect(slider().getAttribute("aria-valuetext")).toBe("0:02.1 of 0:09.0");
    clock.advance(1100); // 3.2 s: step 2 (from 2.3 s) is running, frame 1 (3.15 s) is on screen
    expect(currentStep()).toBe(3);
    expect(frameId()).toBe("1");
  });

  it("highlights the entries of the running step in the console and follows it", async () => {
    await openTrace();
    fireEvent.click(screen.getByRole("tab", { name: /Console/ }));
    const entry = () => screen.getByRole("button", { name: /favicon/ });
    expect(entry().getAttribute("aria-current")).toBe("step");
    fireEvent.click(playButton());
    clock.advance(2100); // step 1 is running: no console entry belongs to it
    expect(entry().getAttribute("aria-current")).toBeNull();
    fireEvent.click(playButton());
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(entry().getAttribute("aria-current")).toBe("step");
  });

  it("stops at the end and restarts from the beginning when played again", async () => {
    await openTrace();
    fireEvent.click(playButton());
    clock.advance(9000, 500);
    expect(isPlaying()).toBe(false);
    expect(currentStep()).toBe(8);
    expect(frameId()).toBe("5");
    expect(screen.getByTestId("playback-time").textContent).toBe("0:09.0 / 0:09.0");
    fireEvent.click(playButton());
    expect(isPlaying()).toBe(true);
    expect(currentStep()).toBe(1);
    expect(frameId()).toBe("0");
    clock.advance(2100);
    expect(currentStep()).toBe(2);
  });

  it("toggles with Space on the page, but leaves Space to real controls", async () => {
    await openTrace();
    fireEvent.keyDown(document.body, { key: " " });
    expect(isPlaying()).toBe(true);
    fireEvent.keyDown(document.body, { key: " " });
    expect(isPlaying()).toBe(false);
    fireEvent.keyDown(screen.getByRole("tab", { name: /Console/ }), { key: " " });
    fireEvent.keyDown(playButton(), { key: " " });
    fireEvent.keyDown(menuButton("Speed"), { key: " " });
    expect(isPlaying()).toBe(false);
  });

  it("lets Space play from the navigation buttons, once, and swallows the release", async () => {
    await openTrace();
    for (const target of [stepButton(2), screen.getByRole("button", { name: /^Frame 2,/ }), screen.getByRole("button", { name: "Step 3" })]) {
      fireEvent.keyDown(target, { key: " " });
      expect(isPlaying()).toBe(true);
      fireEvent.keyDown(target, { key: " ", repeat: true });
      expect(isPlaying()).toBe(true);
      expect(fireEvent.keyUp(target, { key: " " })).toBe(false); // default prevented: no native click
      fireEvent.keyDown(target, { key: " " });
      expect(isPlaying()).toBe(false);
    }
  });

  it("ignores key repeat for Space", async () => {
    await openTrace();
    fireEvent.keyDown(document.body, { key: " ", repeat: true });
    expect(isPlaying()).toBe(false);
  });

  it("toggles with Space on the playhead itself, and ignores the page keys while a menu is open", async () => {
    await openTrace();
    fireEvent.keyDown(slider(), { key: " " });
    expect(isPlaying()).toBe(true);
    fireEvent.keyDown(slider(), { key: " " });
    expect(isPlaying()).toBe(false);
    fireEvent.click(menuButton("Speed"));
    const item = await screen.findByRole("menuitemradio", { name: "2×" });
    fireEvent.keyDown(item, { key: " " });
    fireEvent.keyDown(item, { key: "ArrowRight" });
    expect(isPlaying()).toBe(false);
    expect(currentStep()).toBe(1);
  });

  it("pauses when a step, a frame or a log entry is chosen, and moves the playhead there", async () => {
    await openTrace();
    fireEvent.click(playButton());
    clock.advance(500);
    fireEvent.click(stepButton(5)); // the playhead goes to the frame shown for it, at 7.65 s
    expect(isPlaying()).toBe(false);
    expect(slider().getAttribute("aria-valuenow")).toBe("7650");
    expect(frameId()).toBe("3");

    fireEvent.click(playButton());
    fireEvent.click(screen.getByRole("button", { name: /^Frame 3,/ })); // 3.95 s
    expect(isPlaying()).toBe(false);
    expect(slider().getAttribute("aria-valuenow")).toBe("3950");

    fireEvent.click(screen.getByRole("tab", { name: /Console/ }));
    fireEvent.click(playButton());
    fireEvent.click(screen.getByRole("button", { name: /favicon/ }));
    expect(isPlaying()).toBe(false);
    expect(currentStep()).toBe(1);
    expect(slider().getAttribute("aria-valuenow")).toBe("1950");
  });

  it("keeps the frame when Play follows a manual choice", async () => {
    await openTrace();
    fireEvent.click(stepButton(5));
    expect(frameId()).toBe("3");
    fireEvent.click(playButton());
    clock.advance(32);
    expect(currentStep()).toBe(5);
    expect(frameId()).toBe("3");
  });

  it("pauses on the step keys", async () => {
    await openTrace();
    for (const key of ["ArrowRight", "Home", "End"]) {
      fireEvent.click(playButton());
      fireEvent.keyDown(window, { key });
      expect(isPlaying()).toBe(false);
    }
    expect(currentStep()).toBe(8);
  });

  it("changes the speed", async () => {
    await openTrace();
    await choose("Speed", "4×");
    expect(choice("Speed")).toBe("4×");
    fireEvent.click(playButton());
    clock.advance(600); // 2.4 s of trace time at 4x
    expect(currentStep()).toBe(3);
    await choose("Speed", "0.5×");
    clock.advance(1000); // 0.5 s more
    expect(screen.getByTestId("playback-time").textContent).toBe("0:02.9 / 0:09.0");
  });

  it("paces by step: every step takes 1.5 s", async () => {
    await openTrace();
    await choose("Pace", "Per step");
    expect(choice("Pace")).toBe("Per step");
    fireEvent.click(playButton());
    clock.advance(1600, 200); // real time would still be in step 0
    expect(currentStep()).toBe(2);
    clock.advance(1500, 100);
    expect(currentStep()).toBe(3);
    await choose("Pace", "Real time");
    expect(isPlaying()).toBe(true);
    clock.advance(10_000, 1000);
    expect(isPlaying()).toBe(false);
    expect(currentStep()).toBe(8);
  });

  it("seeks and pauses from the playhead keys", async () => {
    await openTrace();
    fireEvent.click(playButton());
    clock.advance(100);
    fireEvent.keyDown(slider(), { key: "ArrowRight" }); // +1 % of 9 s
    expect(isPlaying()).toBe(false);
    expect(slider().getAttribute("aria-valuenow")).toBe("190");
    fireEvent.keyDown(slider(), { key: "ArrowRight", shiftKey: true }); // +10 %
    expect(slider().getAttribute("aria-valuenow")).toBe("1090");
    fireEvent.keyDown(slider(), { key: "End" });
    expect(slider().getAttribute("aria-valuenow")).toBe("9000");
    expect(currentStep()).toBe(8);
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(slider().getAttribute("aria-valuenow")).toBe("0");
    expect(currentStep()).toBe(1);
    // The slider owns its arrows: the step did not move on the page-level ArrowRight.
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(currentStep()).toBe(1);
  });

  it("scrubs to the middle of a repeat tile's time slot, and keeps repeats out of the accessibility tree", async () => {
    await openTrace();
    const repeats = screen.getAllByTestId("filmstrip-repeat");
    expect(repeats.every((el) => el.getAttribute("aria-hidden") === "true" && el.tagName === "DIV")).toBe(true);
    const tiles = repeats.length + 6; // 6 frames, one home tile each
    fireEvent.click(playButton());
    fireEvent.click(repeats[0]!); // slot 0 repeats the first frame
    expect(isPlaying()).toBe(false);
    expect(Number(slider().getAttribute("aria-valuenow"))).toBeCloseTo((0.5 * 9000) / tiles, -1);
  });

  it("seeks and pauses by dragging on the axis", async () => {
    await openTrace();
    const axis = screen.getByTestId("trace-axis");
    vi.spyOn(axis, "getBoundingClientRect").mockReturnValue({ left: 100, width: 900, right: 1000, top: 0, bottom: 8, height: 8, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.click(playButton());
    fireEvent.pointerDown(axis, { clientX: 100 + 450, button: 0, pointerId: 1 }); // half way: 4.5 s
    expect(isPlaying()).toBe(false);
    expect(slider().getAttribute("aria-valuenow")).toBe("4500");
    expect(currentStep()).toBe(5);
    fireEvent.pointerMove(axis, { clientX: 100 + 900 * 0.1, pointerId: 1 });
    expect(slider().getAttribute("aria-valuenow")).toBe("900");
    expect(currentStep()).toBe(1);
    fireEvent.pointerUp(axis, { pointerId: 1 });
    fireEvent.pointerMove(axis, { clientX: 1000, pointerId: 1 });
    expect(slider().getAttribute("aria-valuenow")).toBe("900");
  });

  it("selects a step from its span after a drag that never produced a click on it", async () => {
    await openTrace();
    const axis = screen.getByTestId("trace-axis");
    vi.spyOn(axis, "getBoundingClientRect").mockReturnValue({ left: 0, width: 900, right: 900, top: 0, bottom: 8, height: 8, x: 0, y: 0, toJSON: () => ({}) });
    const span = screen.getByRole("button", { name: "Step 2" });
    fireEvent.pointerDown(span, { clientX: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(axis, { clientX: 450, pointerId: 1 });
    fireEvent.pointerUp(axis, { pointerId: 1 }); // the browser sends the click to the track, not the span
    await new Promise((done) => setTimeout(done, 5));
    fireEvent.click(span);
    expect(currentStep()).toBe(2);
  });

  it("selects a step from its span, and does not when the press became a drag", async () => {
    await openTrace();
    const span = screen.getByRole("button", { name: "Step 6" });
    fireEvent.pointerDown(span, { clientX: 10, button: 0, pointerId: 1 });
    fireEvent.click(span);
    expect(currentStep()).toBe(6);

    const other = screen.getByRole("button", { name: "Step 2" });
    const axis = screen.getByTestId("trace-axis");
    vi.spyOn(axis, "getBoundingClientRect").mockReturnValue({ left: 0, width: 900, right: 900, top: 0, bottom: 8, height: 8, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(other, { clientX: 10, button: 0, pointerId: 2 });
    fireEvent.pointerMove(axis, { clientX: 450, pointerId: 2 });
    fireEvent.pointerUp(axis, { pointerId: 2 });
    fireEvent.click(other);
    expect(slider().getAttribute("aria-valuenow")).toBe("4500");
    expect(currentStep()).toBe(5);
  });

  it("keeps steps that share a start apart in per-step pacing", async () => {
    answer({ ok: true, status: 200, json: async () => twinTrace() });
    renderTrace();
    await screen.findByTestId("trace-frame");
    await choose("Pace", "Per step");
    fireEvent.click(stepButton(2)); // the first of two steps that start together
    fireEvent.click(playButton());
    clock.advance(100);
    expect(currentStep()).toBe(2);
    clock.advance(1500);
    expect(currentStep()).toBe(3);
  });

  it("stops the loop when the viewer unmounts", async () => {
    await openTrace();
    fireEvent.click(playButton());
    clock.advance(50);
    expect(clock.running).toBe(true);
    cleanup();
    expect(clock.running).toBe(false);
  });
});
