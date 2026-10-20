import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";
import { answer, frameId, renderTrace, serveSample, stepButton } from "@/components/trace/__tests__/traceTestUtils";

describe("TracePage", () => {
  beforeEach(() => serveSample());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as { penDesktop?: unknown }).penDesktop;
  });

  it("shows a skeleton, then the header, steps and the document title", async () => {
    renderTrace();
    expect(screen.getByRole("status", { name: "Loading trace" })).toBeTruthy();
    await screen.findByRole("heading", { level: 1, name: /free trial/ });
    expect(screen.getByTestId("trace-outcome").textContent).toContain("QA failed");
    expect(within(screen.getByRole("region", { name: "Steps" })).getAllByRole("button")).toHaveLength(8);
    expect(document.title).toMatch(/^Trace · Check that a visitor can start a free trial/);
    // The result is a document, not page text.
    expect(screen.queryByText(/Result:/)).toBeNull();
    expect(screen.queryByText("The trial button is missing on the pricing page.")).toBeNull();
    expect(screen.getByRole("button", { name: "Open result" })).toBeTruthy();
  });

  it("selects a step's last frame and toggles before/after", async () => {
    renderTrace();
    await screen.findByTestId("trace-frame");
    expect(frameId()).toBe("0");
    fireEvent.click(stepButton(4)); // step index 3
    expect(frameId()).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "before" }));
    expect(frameId()).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "after" }));
    expect(frameId()).toBe("2");
  });

  it("steps with the arrow keys and toggles with B", async () => {
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
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: "before" }).getAttribute("aria-pressed")).toBe("true");
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
    expect(screen.queryByRole("tab", { name: /^Step$/ })).toBeNull();
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
    expect(await screen.findByText("No steps were recorded.")).toBeTruthy();
    expect(screen.getByText("No frames were captured in this run.")).toBeTruthy();
    expect(screen.getByText(/^No frame for this step/)).toBeTruthy();
  });
});
