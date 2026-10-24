import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceSwitcher } from "../TraceSwitcher";
import type { TraceSource } from "@/lib/browseTraces";

const traces = [
  { id: "t1", goal: "First goal\nmore", startedAt: Date.UTC(2026, 9, 1, 12, 0), status: "done" },
  { id: "t2", goal: "Second goal", startedAt: Date.UTC(2026, 9, 2, 12, 0), status: "done", qaOutcome: "failed" },
];

const bridge = (list?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = { traces: { list } };
};

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

const renderSwitcher = (source: TraceSource = "local", url = "/trace/t1?src=local&chat=off&step=3") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TraceSwitcher currentId="t1" source={source} />
      <Where />
    </MemoryRouter>,
  );
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Traces" }));

afterEach(() => {
  cleanup();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("TraceSwitcher", () => {
  it("does not render without a list bridge", () => {
    bridge(undefined);
    renderSwitcher();
    expect(screen.queryByRole("button", { name: "Traces" })).toBeNull();
  });

  it("lists the traces with a check on the current one and loads on every open", async () => {
    const list = vi.fn(async () => ({ traces }));
    bridge(list);
    renderSwitcher();
    openMenu();
    const current = await screen.findByRole("menuitem", { name: /First goal/ });
    expect(current.querySelector("svg")).not.toBeNull();
    const other = screen.getByRole("menuitem", { name: /Second goal/ });
    expect(other.textContent).toContain("QA failed");
    expect(other.querySelector("svg")).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("puts no check on a cloud trace with the same id", async () => {
    bridge(async () => ({ traces }));
    renderSwitcher("cloud", "/trace/t1");
    openMenu();
    const item = await screen.findByRole("menuitem", { name: /First goal/ });
    expect(item.querySelector("svg")).toBeNull();
  });

  it("opens another trace as local, keeps chat=off and drops step", async () => {
    bridge(async () => ({ traces }));
    renderSwitcher();
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Second goal/ }));
    const where = screen.getByTestId("where").textContent ?? "";
    const [path, query] = where.split("?");
    const params = new URLSearchParams(query);
    expect(path).toBe("/trace/t2");
    expect([params.get("src"), params.get("chat"), params.has("step")]).toEqual(["local", "off", false]);
  });

  it("stays put when the current trace is chosen", async () => {
    bridge(async () => ({ traces }));
    renderSwitcher();
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /First goal/ }));
    expect(screen.getByTestId("where").textContent).toBe("/trace/t1?src=local&chat=off&step=3");
  });

  it.each([
    ["an error", async () => ({ error: "nope" }), "Could not load traces."],
    ["no traces", async () => ({ traces: [] }), "No saved traces"],
  ])("shows %s inside the menu", async (_name, list, text) => {
    bridge(list);
    renderSwitcher();
    openMenu();
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("shows the error message under the title and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bridge(async () => ({ error: "disk gone" }));
    renderSwitcher();
    openMenu();
    expect(await screen.findByText("disk gone")).toBeTruthy();
    expect(screen.getByText("Could not load traces.")).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("applies only the latest answer when an older one resolves last", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    bridge(() => new Promise((r) => resolvers.push(r)));
    renderSwitcher();
    openMenu();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    openMenu();
    await vi.waitFor(() => expect(resolvers.length).toBe(2));
    await act(async () => resolvers[1]({ traces: [traces[1]] }));
    await act(async () => resolvers[0]({ traces: [traces[0]] }));
    expect(await screen.findByRole("menuitem", { name: /Second goal/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /First goal/ })).toBeNull();
  });

  it("shows a loading line until the first answer", async () => {
    bridge(() => new Promise(() => {}));
    renderSwitcher();
    openMenu();
    expect(await screen.findByText("Loading traces…")).toBeTruthy();
  });
});
