import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";
import { answer, frameId, renderTrace, serveSample, stepButton } from "@/components/trace/__tests__/traceTestUtils";

describe("TracePage", () => {
  beforeEach(() => serveSample());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem("pen.trace.detailsOpen");
    delete (window as { penDesktop?: unknown }).penDesktop;
  });

  it("shows a skeleton, then the header, steps and the document title", async () => {
    renderTrace();
    expect(screen.getByRole("status", { name: "Loading trace" })).toBeTruthy();
    await screen.findByRole("heading", { level: 1, name: /free trial/ });
    const badge = screen.getByTestId("trace-outcome");
    expect(badge.textContent).toContain("QA failed");
    expect(badge.className).toContain("h-7");
    expect(badge.className).toContain("border-border");
    expect(badge.className).toContain("text-text-primary");
    expect(badge.className).not.toContain("bg-destructive");
    const icon = badge.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-destructive");
    expect(within(screen.getByRole("region", { name: "Steps" })).getAllByRole("button")).toHaveLength(8);
    expect(document.title).toMatch(/^Check that a visitor can start a free trial/);
    // The result is a document, not page text.
    expect(screen.queryByText(/Result:/)).toBeNull();
    expect(screen.queryByText("The trial button is missing on the pricing page.")).toBeNull();
    expect(screen.getByRole("button", { name: "Open result" })).toBeTruthy();
  });

  it("keeps the header to one row and puts the run facts in a popover", async () => {
    renderTrace();
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector("dl")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Run details/ }));
    const facts = within(document.querySelector("dl") as HTMLElement);
    for (const term of ["Duration", "Steps", "Failed", "Started"]) expect(facts.getByText(term)).toBeTruthy();
    expect(facts.getByText("Failed").nextElementSibling?.className).toContain("text-destructive");
    expect(facts.getByText("Steps").nextElementSibling?.textContent).toBe("8");
  });

  it("shows the run error in the popover", async () => {
    answer({ ok: true, status: 200, json: async () => ({ ...(sampleTraceJson() as object), error: "launch timed out" }) });
    renderTrace();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Run details/ }));
    const popup = document.querySelector("dl")?.parentElement as HTMLElement;
    expect(within(popup).getByText(/Error:/).closest("p")?.textContent).toContain("launch timed out");
  });

  it("selects a step's last frame, with a Before / After switch", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    expect(frameId()).toBe("0");
    fireEvent.click(stepButton(4)); // step index 3
    expect(frameId()).toBe("2");
    expect(screen.getByRole("group", { name: "Frame view" })).toBeTruthy(); // step 4 has a frame of its own and one before it
  });

  it("steps with the arrow keys; B does nothing", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(stepButton(3).getAttribute("aria-current")).toBe("step");
    expect(frameId()).toBe("1");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(stepButton(2).getAttribute("aria-current")).toBe("step");
    fireEvent.keyDown(window, { key: "End" });
    expect(stepButton(8).getAttribute("aria-current")).toBe("step");
    fireEvent.keyDown(window, { key: "ArrowRight" }); // stays on the last step
    expect(stepButton(8).getAttribute("aria-current")).toBe("step");
    const before = frameId();
    fireEvent.keyDown(window, { key: "b" });
    expect(stepButton(8).getAttribute("aria-current")).toBe("step");
    expect(frameId()).toBe(before);
  });

  it("aligns every step row to the top, on one line height", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    const row = stepButton(1);
    expect(row.className).toContain("items-baseline");
    expect(row.className).not.toContain("items-center");
    expect(row.querySelectorAll('[class*="leading-[18px]"]').length).toBeGreaterThanOrEqual(3);
    const cells = Array.from(row.children) as HTMLElement[];
    for (const cell of [cells[0], cells[2]]) {
      expect(cell.className).toContain("text-[13px]");
      expect(cell.className).toContain("tabular-nums");
    }
    expect(within(row).getByTestId("step-title").className).toContain("h-[18px]");
  });

  it("sizes the frame from the loaded image, not the recorded size", async () => {
    renderTrace();
    const img = (await screen.findByTestId("trace-frame")) as HTMLImageElement;
    expect(img.style.aspectRatio).toBe("1.6 / 1"); // first guess: the recorded size
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: 600 });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 1200 });
    fireEvent.load(img);
    expect(screen.getByTestId("trace-frame").style.aspectRatio).toBe("0.5 / 1");
    expect(screen.getByTestId("trace-frame").style.maxWidth).toBe("1200px"); // twice the natural width
  });

  it("hides and shows the details panel, keeps its tab, and remembers the choice", async () => {
    localStorage.removeItem("pen.trace.detailsOpen");
    renderTrace();
    await screen.findByTestId("trace-frame");
    const toggle = () => screen.getByRole("button", { name: "Details panel" });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().hasAttribute("aria-expanded")).toBe(false);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Network/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Network/ }));
    fireEvent.click(toggle());
    expect(screen.queryByRole("tab", { name: /Network/ })).toBeNull(); // hidden, so not accessible
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem("pen.trace.detailsOpen")).toBe("false");
    fireEvent.click(toggle());
    expect(screen.getByRole("tab", { name: /Network/ }).getAttribute("aria-selected")).toBe("true"); // same tab as before
    fireEvent.click(toggle());
    cleanup();
    renderTrace(); // a new viewer starts hidden
    await screen.findByTestId("trace-frame");
    expect(screen.queryByRole("tab", { name: /Console/ })).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByRole("tab", { name: /Console/ })).toBeTruthy();
    expect(localStorage.getItem("pen.trace.detailsOpen")).toBe("true");
  });

  it("flags problems on the run details button and hides Failed at zero", async () => {
    renderTrace();
    await screen.findByRole("heading", { level: 1 });
    const info = screen.getByRole("button", { name: "Run details, has errors" });
    expect(info.className).not.toContain("text-destructive");
    expect(info.querySelector("svg")?.getAttribute("class")).not.toContain("text-destructive");
    const dot = within(info).getByTestId("run-details-dot");
    expect(dot.className).toContain("bg-destructive");
    expect(dot.className).toContain("ring-surface-panel");
    cleanup();
    const clean = sampleTraceJson() as { steps: { ok: boolean; error?: string }[] };
    clean.steps.forEach((st) => {
      st.ok = true;
      delete st.error;
    });
    answer({ ok: true, status: 200, json: async () => clean });
    renderTrace();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Run details" }));
    expect(within(document.querySelector("dl") as HTMLElement).queryByText("Failed")).toBeNull();
  });

  it("leaves the arrow keys to an open popover", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    fireEvent.click(screen.getByRole("button", { name: /^Run details/ }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(stepButton(1).getAttribute("aria-current")).toBe("step");
  });

  it("opens the details when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderTrace();
    await screen.findByTestId("trace-frame");
    expect(screen.getByRole("tab", { name: /Console/ })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("leaves arrow keys to the tab list", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Console/ }), { key: "ArrowRight" });
    expect(stepButton(1).getAttribute("aria-current")).toBe("step");
  });

  it("selects the owning step from a filmstrip frame", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    fireEvent.click(screen.getByRole("button", { name: /^Frame 4,/ }));
    expect(stepButton(5).getAttribute("aria-current")).toBe("step");
    expect(frameId()).toBe("3");
  });

  it("shows log counts and links entries to steps", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    expect(screen.getByRole("tab", { name: /^Step$/ }).getAttribute("aria-selected")).toBe("true");
    const consoleTab = screen.getByRole("tab", { name: /Console/ });
    expect(consoleTab.textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Network/ }).textContent).toContain("2");
    fireEvent.click(consoleTab);
    fireEvent.click(await screen.findByRole("button", { name: /favicon/ }));
    expect(stepButton(1).getAttribute("aria-current")).toBe("step");
  });

  it("shows the QA verdict, checks and judge", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    fireEvent.click(screen.getByRole("tab", { name: /QA/ }));
    expect(await screen.findByText("Text “Start free trial” is visible")).toBeTruthy();
    expect(screen.getByText(/The scenario expects a trial button/)).toBeTruthy();
    expect(screen.getAllByLabelText("Failed").length).toBeGreaterThan(0);
  });

  it.each([
    ["404", { ok: false, status: 404 }, /Trace not found/],
    ["a broken file", { ok: true, status: 200, json: async () => ({ hello: 1 }) }, /not a Sideform trace/],
    ["a server error", { ok: false, status: 500 }, /could not be loaded/],
  ])("renders %s", async (_name, response, heading) => {
    answer(response as Partial<Response>);
    renderTrace();
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  });

  it("retries after an error", async () => {
    answer({ ok: false, status: 500 });
    renderTrace();
    const retry = await screen.findByRole("button", { name: "Try again" });
    serveSample();
    await act(async () => fireEvent.click(retry));
    expect(await screen.findByTestId("trace-frame")).toBeTruthy();
  });

  it("asks for the desktop app when the local bridge is missing", async () => {
    renderTrace("/trace/abc?src=local");
    expect(await screen.findByRole("heading", { name: /desktop app/ })).toBeTruthy();
  });

  it("loads a local trace through the bridge", async () => {
    const read = vi.fn(async () => ({ trace: sampleTraceJson() }));
    (window as unknown as { penDesktop: unknown }).penDesktop = { traces: { read } };
    renderTrace("/trace/sample-trace-1?src=local");
    await screen.findByTestId("trace-frame");
    await waitFor(() => expect(read).toHaveBeenCalledWith("sample-trace-1"));
  });

  it("shows empty states for a run without steps or frames", async () => {
    answer({ ok: true, status: 200, json: async () => ({ ...(sampleTraceJson() as object), steps: [], frames: [], console: [], network: [], qa: undefined }) });
    renderTrace();
    expect(await screen.findByText("No steps were recorded")).toBeTruthy();
    expect(screen.getByText("No frames were captured in this run")).toBeTruthy();
    expect(screen.getByText(/^No frame for this step/)).toBeTruthy();
  });
});
