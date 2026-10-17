import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowseAgentIndicator } from "../BrowseAgentIndicator";
import { useBrowseAgentPhaseStore } from "@/store/browseAgentPhaseStore";

afterEach(() => {
  cleanup();
  useBrowseAgentPhaseStore.setState({ phases: {} });
});

const SETUP = {
  steps: [{ action: "click", selector: "#a" }, { action: "wait", ms: 5 }],
  network: [{ url: "https://api.test/*", body: "SECRET-BODY", headers: { authorization: "SECRET-HEADER" } }],
  fresh: true,
  storage: {
    cookies: [{ name: "sid", value: "SECRET-COOKIE", domain: "a.test" }],
    origins: [{ origin: "https://a.test", localStorage: { k: "SECRET-STORAGE" } }],
  },
  tabs: ["https://b.test"],
  expect: { text: "3 items" },
};

function part(over: Record<string, unknown> = {}) {
  return {
    type: "tool-browse_agent",
    toolCallId: "tc-1",
    state: "input-available",
    input: { goal: "g", url: "https://shop.test/cart?token=abc#frag", setup: SETUP },
    ...over,
  };
}

describe("<BrowseAgentIndicator />", () => {
  it("running + setup: collapsed chip hides Setup, shows host+path hint; expanded Setup pane has no secrets", () => {
    const { container } = render(<BrowseAgentIndicator part={part()} />);
    expect(screen.getByText("Browse Agent")).toBeTruthy();
    expect(screen.getByText("Running...")).toBeTruthy();
    expect(screen.getByText("shop.test/cart")).toBeTruthy();
    expect(screen.queryByText("Setup")).toBeNull();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Setup")).toBeTruthy();
    expect(
      screen.getByText(
        "shop.test/cart · 2 steps · 1 API mock · fresh session · 1 cookie · storage for 1 origin · 1 tab · expect \"3 items\"",
      ),
    ).toBeTruthy();
    const html = container.innerHTML;
    for (const secret of ["SECRET-BODY", "SECRET-HEADER", "SECRET-COOKIE", "SECRET-STORAGE"]) {
      expect(html).not.toContain(secret);
    }
    // The Setup summary and the hint drop the query and hash (the raw Input pane keeps the url as given).
    const pane = screen.getByText("Setup").nextElementSibling;
    expect(pane?.textContent).not.toMatch(/token=abc|frag/);
    expect(screen.getByText("shop.test/cart").textContent).not.toMatch(/token=abc|frag/);
  });

  it("setup phase shows Preparing page...", () => {
    useBrowseAgentPhaseStore.getState().setPhase("tc-1", "setup");
    render(<BrowseAgentIndicator part={part()} />);
    expect(screen.getByText("Preparing page...")).toBeTruthy();
    expect(screen.queryByText("Running...")).toBeNull();
  });

  it.each(["done", "step_limit"])("%s with an applied fixture: expect check mark, no mock warning or amber", (status) => {
    const { container } = render(
      <BrowseAgentIndicator
        part={part({ state: "output-available", output: JSON.stringify({ status, answer: "", steps: 3, setupApplied: true }) })}
      />,
    );
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText(/· expect ✓$/)).toBeTruthy();
    expect(screen.queryByText(/API responses were mocked/)).toBeNull();
    expect(container.innerHTML).not.toContain("amber");
  });

  it("aborted without an applied fixture: no expect check mark", () => {
    render(
      <BrowseAgentIndicator
        part={part({ state: "output-available", output: JSON.stringify({ status: "aborted", answer: "", steps: 0 }) })}
      />,
    );
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.queryByText(/expect ✓/)).toBeNull();
    expect(screen.getByText(/expect "3 items"$/)).toBeTruthy();
  });

  it("expanded Input never contains secrets", () => {
    const secretPart = part({
      input: {
        goal: "g",
        setup: {
          ...SETUP,
          steps: [{ action: "type", selector: "#p", text: "SECRET-TYPED" }],
          storage: {
            cookies: [{ name: "sid", value: "SECRET-COOKIE", domain: "a.test" }],
            origins: [{ origin: "https://a.test", localStorage: { SECRET_KEY: "SECRET-STORAGE" }, sessionStorage: { k2: "SECRET-SESSION" } }],
          },
        },
      },
    });
    const { container } = render(<BrowseAgentIndicator part={secretPart} />);
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Input")).toBeTruthy();
    const html = container.innerHTML;
    for (const secret of [
      "SECRET-BODY", "SECRET-HEADER", "SECRET-COOKIE", "SECRET-STORAGE", "SECRET_KEY", "SECRET-SESSION", "SECRET-TYPED",
    ]) {
      expect(html).not.toContain(secret);
    }
    expect(html).toContain("[hidden]");
  });

  it("object output works and the Setup pane has no prefix", () => {
    render(
      <BrowseAgentIndicator
        part={part({
          input: { goal: "g", setup: { steps: [{ action: "wait", ms: 1 }] } },
          state: "output-available",
          output: { status: "done", answer: "ok", steps: 1, setupApplied: true },
        })}
      />,
    );
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("1 step")).toBeTruthy();
  });

  it("setup_failed: red label, no amber; Stage pane only after expanding", () => {
    const { container } = render(
      <BrowseAgentIndicator
        part={part({
          state: "output-available",
          output: JSON.stringify({
            status: "setup_failed",
            answer: "",
            steps: 0,
            error: 'text "3 items" not found',
            setupStage: "expect",
          }),
        })}
      />,
    );
    expect(screen.getByText("Setup failed").className).not.toContain("text-red-500");
    expect(screen.getByTestId("tool-error-icon")).toBeTruthy();
    expect(container.innerHTML).not.toContain("amber");
    expect(screen.queryByText("Stage")).toBeNull();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Stage")).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === 'expect — text "3 items" not found\nThe agent did not run.'),
    ).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("unparsable output falls back to the plain indicator; Input/Output still opens", () => {
    render(<BrowseAgentIndicator part={part({ input: { goal: "g" }, state: "output-available", output: "not json" })} />);
    expect(screen.getByText("Done")).toBeTruthy();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.queryByText("Setup")).toBeNull();
    expect(screen.getByText("Output")).toBeTruthy();
  });

  it("error state keeps the Error label", () => {
    render(<BrowseAgentIndicator part={part({ state: "output-error", errorText: "x" })} />);
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("an empty setup summary counts as no setup: no pane, no Preparing label", () => {
    useBrowseAgentPhaseStore.getState().setPhase("tc-1", "setup");
    render(<BrowseAgentIndicator part={part({ input: { goal: "g", setup: {} } })} />);
    expect(screen.queryByText("Preparing page...")).toBeNull();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.queryByText("Setup")).toBeNull();
  });
});

describe("<BrowseAgentIndicator /> checkpoints", () => {
  it("shows Resumed from and the saved checkpoint, ids only", () => {
    const out = JSON.stringify({ status: "done", answer: "", steps: 2, setupApplied: true, checkpoint: { id: "cp_3", complete: false, summary: "SUMMARY-X", gap: "g" } });
    render(
      <BrowseAgentIndicator
        part={part({ state: "output-available", input: { goal: "g", resume: "cp_2" }, output: out })}
      />,
    );
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Resumed from cp_2")).toBeTruthy();
    expect(screen.getByText("Checkpoint cp_3 saved (partial)")).toBeTruthy();
  });

  it("does not claim a resume that failed", () => {
    const out = JSON.stringify({ status: "setup_failed", setupStage: "validate", error: "checkpoint cp_9 not found" });
    render(<BrowseAgentIndicator part={part({ state: "output-available", input: { goal: "g", resume: "cp_9" }, output: out })} />);
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.queryByText(/Resumed from/)).toBeNull();
  });

  it("a resume shows Preparing page... in the setup phase", () => {
    useBrowseAgentPhaseStore.getState().setPhase("tc-1", "setup");
    render(<BrowseAgentIndicator part={part({ input: { goal: "g", resume: "cp_2" } })} />);
    expect(screen.getByText("Preparing page...")).toBeTruthy();
  });

  it("a complete checkpoint has no partial note", () => {
    const out = JSON.stringify({ status: "done", answer: "", steps: 2, checkpoint: { id: "cp_1", complete: true, summary: "s" } });
    render(<BrowseAgentIndicator part={part({ state: "output-available", input: { goal: "g" }, output: out })} />);
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Checkpoint cp_1 saved")).toBeTruthy();
  });

  it("shows the QA outcome as a badge", () => {
    const res = (qa: Record<string, unknown>) =>
      JSON.stringify({ status: "done", answer: "", steps: 2, qa: { steps: [], ...qa } });
    const view = (qa: Record<string, unknown>) =>
      render(<BrowseAgentIndicator part={part({ state: "output-available", input: { goal: "g", qa: true }, output: res(qa) })} />);
    view({ outcome: "passed", verdict: "pass", reason: "all good" });
    expect(screen.getByText("Passed ✓")).toBeTruthy();
    cleanup();
    view({ outcome: "failed", verdict: "fail", reason: "cart empty" });
    expect(screen.getByText("Failed ✗")).toBeTruthy();
    expect(screen.getByTestId("tool-error-icon")).toBeTruthy();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("cart empty")).toBeTruthy();
    cleanup();
    view({ outcome: "inconclusive" });
    expect(screen.getByText("No verdict")).toBeTruthy();
    cleanup();
    view({ outcome: "error", reason: "deadline reached" });
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByTestId("tool-error-icon")).toBeTruthy();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Reason")).toBeTruthy();
    expect(screen.queryByText("Verdict")).toBeNull();
    cleanup();
    view({ outcome: "aborted" });
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.queryByTestId("tool-error-icon")).toBeNull();
  });

  it("a run without qa keeps the plain Done label", () => {
    const out = JSON.stringify({ status: "done", answer: "x", steps: 1 });
    render(<BrowseAgentIndicator part={part({ state: "output-available", input: { goal: "g" }, output: out })} />);
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
