import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShowcaseAgentComposer } from "@/components/showcase/ShowcaseAgentComposer";

afterEach(cleanup);

describe("<ShowcaseAgentComposer />", () => {
  it("keeps the textarea at 16px on phones and touch screens (iOS Safari zooms below 16px)", () => {
    const css = readFileSync(`${process.cwd()}/src/components/showcase/showcaseLanding.css`, "utf8");
    const mobileRule = /@media \(max-width: 809px\), \(pointer: coarse\) \{\s*\.sf-composer textarea \{([^}]*)\}/.exec(css);

    expect(mobileRule?.[1]).toContain("font-size: 16px");
  });

  it("keeps send disabled for an empty or whitespace-only prompt", () => {
    render(<ShowcaseAgentComposer onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText("Ask Sideform Agent to create…");
    const send = screen.getByRole("button", { name: "Send" });

    expect(input.getAttribute("rows")).toBe("1");
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "   " } });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("focuses the textarea when the composer container is clicked", () => {
    render(<ShowcaseAgentComposer onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText("Ask Sideform Agent to create…");
    fireEvent.click(input.closest("form")!);

    expect(document.activeElement).toBe(input);
  });

  it("submits a trimmed prompt with Enter", () => {
    const onSubmit = vi.fn();
    render(<ShowcaseAgentComposer onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText("Ask Sideform Agent to create…");
    fireEvent.change(input, {
      target: { value: "  Build a calm finance dashboard  " },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Build a calm finance dashboard");
  });

  it("leaves Shift+Enter to the textarea without submitting", () => {
    const onSubmit = vi.fn();
    render(<ShowcaseAgentComposer onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText("Ask Sideform Agent to create…");
    fireEvent.change(input, { target: { value: "first line" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("first line");
  });

  it("submits through the visible arrow button", () => {
    const onSubmit = vi.fn();
    render(<ShowcaseAgentComposer onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByPlaceholderText("Ask Sideform Agent to create…"),
      { target: { value: "Create a portfolio" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith("Create a portfolio");
  });
});
