import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { ContextMeter } from "../ContextMeter";

const KNOWN_MODEL = "deepseek/deepseek-v4.1-flash"; // contextWindow 1048576 (chatModels.ts)

afterEach(() => cleanup());

function setChatState(overrides: {
  activeChatId?: string | null;
  model?: string;
  contextTokens?: Record<string, number>;
}) {
  useChatStore.setState({
    activeChatId: "tab-A",
    model: KNOWN_MODEL,
    contextTokens: {},
    ...overrides,
  });
}

describe("<ContextMeter />", () => {
  it("renders nothing when the model's context window is unknown", () => {
    setChatState({
      model: "nobody/knows-this-model",
      contextTokens: { "tab-A": 100_000 },
    });

    const { container } = render(<ContextMeter />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the active chat has no reported contextTokens yet", () => {
    setChatState({ contextTokens: {} });

    const { container } = render(<ContextMeter />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no active chat", () => {
    setChatState({ activeChatId: null, contextTokens: {} });

    const { container } = render(<ContextMeter />);
    expect(container.firstChild).toBeNull();
  });

  it("renders with the correct aria-label once data is available", () => {
    // 131072 / 1048576 = 12.5% -> rounds to 13%.
    setChatState({ contextTokens: { "tab-A": 131_072 } });

    render(<ContextMeter />);

    const meter = screen.getByTestId("context-meter");
    expect(meter.getAttribute("aria-label")).toBe("Context: 13% · 131.1K / 1M");
    expect(meter.getAttribute("role")).toBe("img");
  });

  it("only reflects the active chat's own reading, not another chat's", () => {
    setChatState({
      contextTokens: { "tab-A": 100_000, "tab-B": 999_000 },
    });

    render(<ContextMeter />);

    expect(screen.getByTestId("context-meter").getAttribute("aria-label")).toContain(
      "100K",
    );
  });

  it("uses the muted color below the warning threshold", () => {
    setChatState({ contextTokens: { "tab-A": 100_000 } }); // ~10%

    render(<ContextMeter />);

    const arc = screen.getByTestId("context-meter").querySelectorAll("circle")[1];
    expect(arc.getAttribute("class")).toContain("text-text-muted");
    expect(arc.getAttribute("class")).not.toContain("text-destructive");
    expect(arc.getAttribute("class")).not.toContain("text-amber-500");
  });

  it("uses the warning color at >=75% fill", () => {
    setChatState({ contextTokens: { "tab-A": 800_000 } }); // ~76%

    render(<ContextMeter />);

    const arc = screen.getByTestId("context-meter").querySelectorAll("circle")[1];
    expect(arc.getAttribute("class")).toContain("text-amber-500");
  });

  it("uses the danger color at >=90% fill", () => {
    setChatState({ contextTokens: { "tab-A": 1_000_000 } }); // ~95%

    render(<ContextMeter />);

    const arc = screen.getByTestId("context-meter").querySelectorAll("circle")[1];
    expect(arc.getAttribute("class")).toContain("text-destructive");
  });

  it("is reachable by keyboard, so the reading isn't hover-only", () => {
    setChatState({ contextTokens: { "tab-A": 100_000 } });

    render(<ContextMeter />);

    // Without a tab stop the tooltip — the only place the numbers exist —
    // can't be opened by keyboard or on the mobile chat panel.
    expect(screen.getByTestId("context-meter").getAttribute("tabindex")).toBe("0");
  });

  it("names a real Tailwind duration utility for the arc transition", () => {
    setChatState({ contextTokens: { "tab-A": 100_000 } });

    render(<ContextMeter />);

    const arc = screen.getByTestId("context-meter").querySelectorAll("circle")[1];
    // `duration-fast` looks like a token but isn't a utility: the duration
    // scale lives in plain `:root`, not `@theme`, so only the numeric
    // `duration-250` form emits anything. A dead class here would silently
    // leave the arc with no transition at all.
    expect(arc.getAttribute("class")).toContain("duration-250");
  });

  it("respects prefers-reduced-motion via a CSS class, not an inline style", () => {
    setChatState({ contextTokens: { "tab-A": 100_000 } });

    render(<ContextMeter />);

    const arc = screen.getByTestId("context-meter").querySelectorAll("circle")[1];
    expect(arc.getAttribute("class")).toContain("motion-reduce:transition-none");
    // The transition must live in the class list, not `style`, or the
    // motion-reduce utility can never win (inline style always beats a
    // stylesheet rule regardless of specificity).
    expect(arc.getAttribute("style") ?? "").not.toContain("transition");
  });
});
