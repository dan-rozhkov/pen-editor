import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LintPanelContent } from "@/components/LintPanel";
import { LINT_IDLE_MS } from "@/hooks/useLintAutoRun";
import { useLintStore } from "@/store/lintStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDragStore } from "@/store/dragStore";
import { seedDocument } from "@/lib/designLint/__tests__/seededDocument";

beforeEach(() => {
  seedDocument();
  useLintStore.setState({ mode: "current", ruleFilter: null, notice: null, hasRun: false, findings: [], summary: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<LintPanelContent />", () => {
  it("shows the summary and findings grouped by rule", () => {
    render(<LintPanelContent />);
    expect(screen.getByTestId("lint-summary").textContent).toMatch(/1 error, \d+ warnings?, \d+ info/);
    expect(screen.getByTestId("lint-group-hardcoded-value")).toBeTruthy();
    expect(screen.getByTestId("lint-group-contrast")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(3);
  });

  it("selects the layer of a finding", () => {
    render(<LintPanelContent />);
    const row = within(screen.getByTestId("lint-group-contrast")).getByTestId("lint-finding");
    fireEvent.click(within(row).getByRole("button", { name: /^Select/ }));
    expect(useSelectionStore.getState().selectedIds).toEqual(["lowContrast"]);
  });

  it("fixes one finding and shows the result", () => {
    render(<LintPanelContent />);
    const row = within(screen.getByTestId("lint-group-contrast")).getByTestId("lint-finding");
    fireEvent.click(within(row).getByRole("button", { name: /^Fix/ }));
    expect(useSceneStore.getState().nodesById.lowContrast.fillBinding).toEqual({ variableId: "v-muted" });
    expect(screen.queryByTestId("lint-group-contrast")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Fixed 1 finding.");
  });

  it("fixes a whole rule, and everything with Fix all", () => {
    render(<LintPanelContent />);
    fireEvent.click(within(screen.getByTestId("lint-group-hardcoded-value")).getByRole("button", { name: /^Fix all/ }));
    expect(screen.queryByTestId("lint-group-hardcoded-value")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Fix all \d+ findings? that have a fix/ }));
    expect(screen.queryByTestId("lint-group-deprecated-token")).toBeNull();
    // The off-scale snap changes a value, so it stays for an explicit click.
    expect(screen.getByTestId("lint-group-off-scale-value")).toBeTruthy();
  });

  it("applies a value-changing fix from its own button", () => {
    render(<LintPanelContent />);
    const row = within(screen.getByTestId("lint-group-off-scale-value")).getByTestId("lint-finding");
    fireEvent.click(within(row).getByRole("button", { name: /^Fix and change the value/ }));
    expect(useSceneStore.getState().nodesById.offScale).toMatchObject({ cornerRadius: 8 });
  });

  it("filters by rule with pressed-state buttons", () => {
    render(<LintPanelContent />);
    const filter = screen.getByRole("group", { name: "Filter by rule" });
    fireEvent.click(within(filter).getByRole("button", { name: /^Contrast/ }));
    expect(within(filter).getByRole("button", { name: /^Contrast/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("lint-group-hardcoded-value")).toBeNull();
    expect(screen.getByTestId("lint-group-contrast")).toBeTruthy();
  });

  it("offers a mode picker that re-checks", () => {
    render(<LintPanelContent />);
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "all" } });
    expect(useLintStore.getState().mode).toBe("all");
  });

  it("counts only the active page and hides Fix all when nothing is fixable", () => {
    render(<LintPanelContent />);
    const { findings, summary } = useLintStore.getState();
    expect(summary?.errors).toBe(findings.filter((f) => f.severity === "error").length);
    act(() => useLintStore.setState({ fixable: {} }));
    expect(screen.queryByRole("button", { name: /^Fix all \d+ findings? that have a fix/ })).toBeNull();
  });

  it("re-runs instead of showing stale findings when the mode cannot resolve", () => {
    render(<LintPanelContent />);
    act(() => useLintStore.setState({ mode: "gone", hasRun: false, findings: [] }));
    act(() => useLintStore.getState().run());
    expect(useLintStore.getState().mode).toBe("current");
    expect(useLintStore.getState().hasRun).toBe(true);
    expect(useLintStore.getState().findings.length).toBeGreaterThan(0);
  });

  it("re-runs when a row belongs to a page that is no longer active", () => {
    render(<LintPanelContent />);
    const [f] = useLintStore.getState().findings;
    act(() => useLintStore.setState({ pageId: "old" }));
    act(() => useLintStore.getState().select(f));
    expect(useLintStore.getState().pageId).not.toBe("old");
  });

  it("notes findings on other pages instead of listing them", () => {
    render(<LintPanelContent />);
    act(() => useLintStore.setState({ otherPages: 2 }));
    expect(screen.getByTestId("lint-other-pages").textContent).toContain("Open that page");
  });
});

describe("idle re-run", () => {
  it("re-checks 1.5 s after the last change, and waits out a drag", () => {
    vi.useFakeTimers();
    render(<LintPanelContent />);
    const runs = vi.fn();
    const run = useLintStore.getState().run;
    act(() => useLintStore.setState({ run: () => (runs(), run()) }));

    act(() => useSceneStore.getState().updateNode("farColor", { fill: "#cc3398" }));
    act(() => void vi.advanceTimersByTime(LINT_IDLE_MS - 100));
    expect(runs).not.toHaveBeenCalled();
    act(() => useSceneStore.getState().updateNode("farColor", { fill: "#cc3397" }));
    act(() => void vi.advanceTimersByTime(LINT_IDLE_MS - 100));
    expect(runs).not.toHaveBeenCalled();

    act(() => useDragStore.setState({ isDragging: true }));
    act(() => void vi.advanceTimersByTime(200));
    expect(runs).not.toHaveBeenCalled();
    act(() => useDragStore.setState({ isDragging: false }));
    act(() => void vi.advanceTimersByTime(LINT_IDLE_MS));
    expect(runs).toHaveBeenCalledTimes(1);
  });
});
