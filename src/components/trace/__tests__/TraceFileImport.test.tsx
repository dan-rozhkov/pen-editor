import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleTraceJson } from "../__fixtures__/sampleTrace";
import { answer, renderTrace } from "./traceTestUtils";

// "/trace": open a trace from a file, in memory.

const file = (value: unknown) => new File([typeof value === "string" ? value : JSON.stringify(value)], "trace.json", { type: "application/json" });
const picker = () => screen.getByLabelText("Trace file", { selector: "input" });

describe("opening a trace file", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem("pen.trace.detailsOpen");
  });

  it("asks for a file, then shows the viewer without touching the address or the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState(null, "", "/trace");
    renderTrace("/trace");
    expect(screen.getByRole("heading", { name: "Open a trace file" })).toBeTruthy();
    fireEvent.change(picker(), { target: { files: [file(sampleTraceJson())] } });
    expect(await screen.findByTestId("trace-frame")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("button", { name: "Copy link to this step" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets the same file be chosen again", async () => {
    renderTrace("/trace");
    const input = picker() as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file("{oops")] } });
    await screen.findByRole("alert");
    expect(input.value).toBe("");
  });

  it("opens a file dropped on the page", async () => {
    renderTrace("/trace");
    fireEvent.drop(screen.getByTestId("trace-drop"), { dataTransfer: { files: [file(sampleTraceJson())] } });
    expect(await screen.findByTestId("trace-frame")).toBeTruthy();
  });

  it.each([
    ["not JSON", "{oops", /not valid JSON/],
    ["not a trace", { hello: 1 }, /format/],
  ])("explains a file that is %s and stays on the page", async (_name, content, message) => {
    renderTrace("/trace");
    fireEvent.change(picker(), { target: { files: [file(content)] } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(message);
    expect(screen.getByRole("heading", { name: "Open a trace file" })).toBeTruthy();
  });

  it("offers the file page from a trace that is not found", async () => {
    answer({ ok: false, status: 404 });
    renderTrace();
    const link = await screen.findByRole("link", { name: "Open a trace file" });
    expect(link.getAttribute("href")).toBe("/trace");
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByLabelText("Trace file", { selector: "input" })).toBeTruthy());
  });
});
