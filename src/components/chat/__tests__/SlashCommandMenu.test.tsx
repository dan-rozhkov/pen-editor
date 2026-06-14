import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SlashCommandMenu } from "../SlashCommandMenu";
import { SLASH_COMMANDS } from "../slashCommands";

afterEach(() => cleanup());

function noop() {}

describe("<SlashCommandMenu />", () => {
  it("renders all commands for an empty query", () => {
    render(<SlashCommandMenu query="" onSelect={noop} onClose={noop} />);
    for (const cmd of SLASH_COMMANDS) {
      expect(screen.getByText(`/${cmd.name}`)).toBeTruthy();
    }
  });

  it("filters commands by name substring", () => {
    render(<SlashCommandMenu query="aud" onSelect={noop} onClose={noop} />);
    expect(screen.getByText("/audit")).toBeTruthy();
    // a non-matching command is gone
    expect(screen.queryByText("/polish")).toBeNull();
  });

  it("filters by description text", () => {
    render(
      <SlashCommandMenu query="performance" onSelect={noop} onClose={noop} />
    );
    // "optimize" has description "Performance improvements"
    expect(screen.getByText("/optimize")).toBeTruthy();
    expect(screen.queryByText("/audit")).toBeNull();
  });

  it("filters by category name", () => {
    render(
      <SlashCommandMenu query="intensity" onSelect={noop} onClose={noop} />
    );
    // Intensity category: quieter + bolder
    expect(screen.getByText("/quieter")).toBeTruthy();
    expect(screen.getByText("/bolder")).toBeTruthy();
    expect(screen.queryByText("/audit")).toBeNull();
  });

  it("renders nothing when no command matches", () => {
    const { container } = render(
      <SlashCommandMenu query="zzzznope" onSelect={noop} onClose={noop} />
    );
    // Component returns null when filtered list is empty.
    expect(container.firstChild).toBeNull();
  });

  it("fires onSelect with the matching command when an item is chosen", () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu query="aud" onSelect={onSelect} onClose={noop} />);
    fireEvent.mouseDown(screen.getByText("/audit"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: "audit" });
  });

  it("selects the highlighted command on Enter", () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu query="aud" onSelect={onSelect} onClose={noop} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: "audit" });
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<SlashCommandMenu query="" onSelect={noop} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves the selection with ArrowDown and selects the next command", () => {
    const onSelect = vi.fn();
    // Two Intensity commands rendered in list order: quieter, bolder.
    render(
      <SlashCommandMenu query="intensity" onSelect={onSelect} onClose={noop} />
    );
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: "bolder" });
  });

  it("groups results under their category headings", () => {
    render(<SlashCommandMenu query="aud" onSelect={noop} onClose={noop} />);
    // audit is in the Diagnostic category — the heading should render.
    expect(screen.getByText("Diagnostic")).toBeTruthy();
  });
});
