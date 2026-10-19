import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ToolCallIndicator } from "../ToolCallIndicator";

afterEach(() => cleanup());

interface ToolPartFixture {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function toolPart(overrides: Partial<ToolPartFixture> = {}): ToolPartFixture {
  return {
    type: "tool-get_variables",
    toolCallId: "call-1",
    state: "input-available",
    input: { foo: "bar" },
    ...overrides,
  };
}

describe("<ToolCallIndicator />", () => {
  it("renders the friendly display name for a known tool", () => {
    render(<ToolCallIndicator part={toolPart()} />);
    // get_variables → "Get Variables" via toolDisplayNames
    expect(screen.getByText("Get Variables")).toBeTruthy();
  });

  it("renders a readable label for load_skill", () => {
    render(<ToolCallIndicator part={toolPart({ type: "tool-load_skill" })} />);
    expect(screen.getByText("Load skill")).toBeTruthy();
  });

  it("falls back to the raw tool name when unmapped", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ type: "tool-some_unmapped_tool" })}
      />
    );
    expect(screen.getByText("some_unmapped_tool")).toBeTruthy();
  });

  it("shows Running... while the tool is in progress", () => {
    render(<ToolCallIndicator part={toolPart({ state: "input-available" })} />);
    expect(screen.getByText("Running...")).toBeTruthy();
  });

  it("shimmers the label while running instead of spinning an icon", () => {
    const { container } = render(
      <ToolCallIndicator part={toolPart({ state: "input-available" })} />
    );
    expect(container.querySelectorAll(".animate-shimmer").length).toBe(2);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("does not shimmer once the tool has finished", () => {
    const { container } = render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: { ok: true } })}
      />
    );
    expect(container.querySelector(".animate-shimmer")).toBeNull();
  });

  it("shows Done when output is available", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: { ok: true } })}
      />
    );
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("shows Error for an output-error state", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-error", errorText: "boom" })}
      />
    );
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("is collapsed by default and does not show the Input section", () => {
    render(<ToolCallIndicator part={toolPart()} />);
    expect(screen.queryByText("Input")).toBeNull();
    expect(screen.queryByText("Output")).toBeNull();
  });

  it("expands to reveal serialized input/output when the header is clicked", () => {
    render(
      <ToolCallIndicator
        part={toolPart({
          state: "output-available",
          input: { a: 1 },
          output: { b: 2 },
        })}
      />
    );
    // The header button carries the display name.
    fireEvent.click(screen.getByText("Get Variables"));
    expect(screen.getByText("Input")).toBeTruthy();
    expect(screen.getByText("Output")).toBeTruthy();
    // Serialized JSON appears in <pre> blocks.
    expect(screen.getByText(/"a": 1/)).toBeTruthy();
    expect(screen.getByText(/"b": 2/)).toBeTruthy();
  });

  it("renders the error text in the expanded output for an errored tool", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-error", errorText: "kaboom" })}
      />
    );
    fireEvent.click(screen.getByText("Get Variables"));
    expect(screen.getByText("kaboom")).toBeTruthy();
  });

  it("renders image previews extracted from a completed output", () => {
    render(
      <ToolCallIndicator
        part={toolPart({
          state: "output-available",
          output: { screenshot: "https://example.com/screenshot.png" },
        })}
      />
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    expect(imgs[0].getAttribute("src")).toBe(
      "https://example.com/screenshot.png"
    );
  });

  it("offers a Download all action when there are multiple images", () => {
    render(
      <ToolCallIndicator
        part={toolPart({
          state: "output-available",
          output: {
            images: [
              "https://example.com/a.png",
              "https://example.com/b.jpg",
            ],
          },
        })}
      />
    );
    expect(screen.getByText("Download all")).toBeTruthy();
  });

  it("does not render images while the tool is still running", () => {
    render(
      <ToolCallIndicator
        part={toolPart({
          state: "input-available",
          input: { url: "https://example.com/x.png" },
        })}
      />
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("handles a dynamic-tool part shape", () => {
    render(
      <ToolCallIndicator
        part={{
          type: "dynamic-tool",
          toolName: "mobbin_search_screens",
          toolCallId: "call-2",
          state: "output-available",
          input: {},
          output: "[]",
        }}
      />
    );
    // mapped display name for mobbin_search_screens
    expect(screen.getByText("Searching screens")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("scopes the expanded JSON to its pre blocks", () => {
    const { container } = render(
      <ToolCallIndicator
        part={toolPart({
          state: "output-available",
          input: { hello: "world" },
          output: { done: true },
        })}
      />
    );
    fireEvent.click(screen.getByText("Get Variables"));
    const pres = container.querySelectorAll("pre");
    expect(pres.length).toBe(2);
    const inputPre = pres[0];
    expect(within(inputPre as HTMLElement).getByText(/"hello": "world"/)).toBeTruthy();
  });

  it("shows a default hint for browse tools, none for other tools", () => {
    const { rerender } = render(
      <ToolCallIndicator part={toolPart({ type: "tool-browse_open", input: { url: "https://a.test/x?q=1#h" } })} />,
    );
    expect(screen.getByText("a.test/x")).toBeTruthy();
    rerender(<ToolCallIndicator part={toolPart({ input: { url: "https://a.test/x" } })} />);
    expect(screen.queryByText("a.test/x")).toBeNull();
  });

  it("an explicit hint wins and statusError swaps the icon for a cross, no red", () => {
    const { container } = render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: {} })}
        hint="my hint"
        statusLabel="Failed"
        statusError
      />,
    );
    expect(screen.getByText("my hint").className).toContain("truncate");
    expect(screen.getByTestId("tool-error-icon")).toBeTruthy();
    expect(container.querySelector("button")?.innerHTML).not.toContain("text-red-500");
  });

  it("renders extraPanes before Input, only when expanded", () => {
    const { container } = render(
      <ToolCallIndicator
        part={toolPart({ input: { a: 1 } })}
        extraPanes={[{ label: "Setup", content: "pane-one" }, { label: "Stage", content: "pane-two" }]}
      />,
    );
    expect(screen.queryByText("pane-one")).toBeNull();
    fireEvent.click(screen.getByText("Get Variables"));
    const labels = Array.from(container.querySelectorAll("div.uppercase")).map((el) => el.textContent);
    expect(labels).toEqual(["Setup", "Stage", "Input", "Output"]);
    expect(screen.getByText("pane-two")).toBeTruthy();
  });
  it("shows Error for an output-available string output of the form {\"error\":...}", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: '{"error":"tab closed"}' })}
      />,
    );
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
    fireEvent.click(screen.getByText("Get Variables"));
    expect(screen.getByText("tab closed")).toBeTruthy();
  });

  it("shows Error for an object output with a string error", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: { error: "boom" } })}
      />,
    );
    expect(screen.getByText("Error")).toBeTruthy();
    fireEvent.click(screen.getByText("Get Variables"));
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("keeps Done for a normal output", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: '{"ok":true}' })}
      />,
    );
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByText("Error")).toBeNull();
  });

  it("keeps Done for {\"error\":null,...} output", () => {
    render(
      <ToolCallIndicator
        part={toolPart({ state: "output-available", output: '{"error":null,"result":1}' })}
      />,
    );
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByText("Error")).toBeNull();
  });
});
