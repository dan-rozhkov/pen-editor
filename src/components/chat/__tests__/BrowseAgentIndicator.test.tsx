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
  it("running + setup: Setup line without secrets, query or hash", () => {
    const { container } = render(<BrowseAgentIndicator part={part()} />);
    expect(screen.getByText("Browse Agent")).toBeTruthy();
    expect(screen.getByText("Running...")).toBeTruthy();
    expect(
      screen.getByText(
        'Setup: https://shop.test/cart · 2 steps · 1 API mock · fresh session · 1 cookie · storage for 1 origin · 1 tab · expect "3 items"',
      ),
    ).toBeTruthy();
    const html = container.innerHTML;
    for (const secret of ["SECRET-BODY", "SECRET-HEADER", "SECRET-COOKIE", "SECRET-STORAGE", "token=abc", "frag"]) {
      expect(html).not.toContain(secret);
    }
  });

  it("setup phase shows Preparing page...", () => {
    useBrowseAgentPhaseStore.getState().setPhase("tc-1", "setup");
    render(<BrowseAgentIndicator part={part()} />);
    expect(screen.getByText("Preparing page...")).toBeTruthy();
    expect(screen.queryByText("Running...")).toBeNull();
  });

  it("done with mocks: expect check mark and the mocked-data warning", () => {
    render(
      <BrowseAgentIndicator
        part={part({ state: "output-available", output: JSON.stringify({ status: "done", answer: "ok", steps: 3, setupApplied: true }) })}
      />,
    );
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText(/· expect ✓$/)).toBeTruthy();
    expect(screen.getByText("⚠ API responses were mocked. Data on these pages is not real.")).toBeTruthy();
  });

  it("step_limit with mocks still warns and shows expect check mark", () => {
    render(
      <BrowseAgentIndicator
        part={part({ state: "output-available", output: JSON.stringify({ status: "step_limit", answer: "", steps: 20, setupApplied: true }) })}
      />,
    );
    expect(screen.getByText(/· expect ✓$/)).toBeTruthy();
    expect(screen.getByText("⚠ API responses were mocked. Data on these pages is not real.")).toBeTruthy();
  });

  it("aborted without an applied fixture: no warning, no expect check mark", () => {
    render(
      <BrowseAgentIndicator
        part={part({ state: "output-available", output: JSON.stringify({ status: "aborted", answer: "", steps: 0 }) })}
      />,
    );
    expect(screen.queryByText(/mocked/)).toBeNull();
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

  it("done without mocks has no warning; object output works", () => {
    render(
      <BrowseAgentIndicator
        part={part({
          input: { goal: "g", setup: { steps: [{ action: "wait", ms: 1 }] } },
          state: "output-available",
          output: { status: "done", answer: "ok", steps: 1, setupApplied: true },
        })}
      />,
    );
    expect(screen.getByText("Setup: 1 step")).toBeTruthy();
    expect(screen.queryByText(/mocked/)).toBeNull();
  });

  it("setup_failed: amber label, stage and not-run line", () => {
    render(
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
    const label = screen.getByText("Setup failed");
    expect(label.className).toContain("text-amber-500");
    expect(screen.getByText('Stage: expect — text "3 items" not found')).toBeTruthy();
    expect(screen.getByText("The agent did not run.")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("unparsable output falls back to the plain indicator; Input/Output still opens", () => {
    render(<BrowseAgentIndicator part={part({ input: { goal: "g" }, state: "output-available", output: "not json" })} />);
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByText(/^Setup:/)).toBeNull();
    fireEvent.click(screen.getByText("Browse Agent"));
    expect(screen.getByText("Output")).toBeTruthy();
  });

  it("error state keeps the Error label", () => {
    render(<BrowseAgentIndicator part={part({ state: "output-error", errorText: "x" })} />);
    expect(screen.getByText("Error")).toBeTruthy();
  });
});
