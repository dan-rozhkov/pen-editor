import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SlashCommandMenu } from "../SlashCommandMenu";
import { SLASH_COMMANDS } from "../slashCommands";
import { useUserSkillStore } from "@/store/userSkillStore";

beforeEach(() => {
  useUserSkillStore.setState({ skills: [], builtIn: [], available: true, status: "idle", error: null });
});

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

  it("lists enabled custom skills under a 'Your skills' category", () => {
    useUserSkillStore.setState({
      skills: [
        {
          name: "contrast-check",
          description: "Flags low contrast text",
          body: "…",
          enabled: true,
          source: "manual",
          useCount: 0,
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
    render(<SlashCommandMenu query="" onSelect={noop} onClose={noop} />);
    expect(screen.getByText("Your skills")).toBeTruthy();
    expect(screen.getByText("/contrast-check")).toBeTruthy();
  });

  it("omits disabled custom skills", () => {
    useUserSkillStore.setState({
      skills: [
        {
          name: "contrast-check",
          description: "Flags low contrast text",
          body: "…",
          enabled: false,
          source: "manual",
          useCount: 0,
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
    render(<SlashCommandMenu query="" onSelect={noop} onClose={noop} />);
    expect(screen.queryByText("/contrast-check")).toBeNull();
  });

  it("fires onSelect with a matching custom skill", () => {
    const onSelect = vi.fn();
    useUserSkillStore.setState({
      skills: [
        {
          name: "contrast-check",
          description: "Flags low contrast text",
          body: "…",
          enabled: true,
          source: "manual",
          useCount: 0,
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
    render(<SlashCommandMenu query="contrast" onSelect={onSelect} onClose={noop} />);
    fireEvent.mouseDown(screen.getByText("/contrast-check"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ name: "contrast-check", category: "Your skills" });
  });

  it("dedups a custom skill against the store's fetched built-in catalog, not just the static list", () => {
    // A skill named "audit" is not in the hardcoded SLASH_COMMANDS list, but
    // IS in the real backend catalog (e.g. it became a curated skill after
    // this frontend build shipped) — it must not show up twice, and the
    // dedup must come from `builtIn`, not the static fallback.
    useUserSkillStore.setState({
      builtIn: [{ name: "audit", description: "Server-curated audit" }],
      skills: [
        {
          name: "audit",
          description: "My custom audit",
          body: "…",
          enabled: true,
          source: "manual",
          useCount: 0,
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
    render(<SlashCommandMenu query="" onSelect={noop} onClose={noop} />);
    // Exactly one /audit entry — the built-in one from SLASH_COMMANDS, not a
    // duplicate "Your skills" entry for the same name.
    expect(screen.getAllByText("/audit")).toHaveLength(1);
    expect(screen.queryByText("My custom audit")).toBeNull();
  });

  it("falls back to the static SLASH_COMMANDS list for dedup when builtIn hasn't loaded yet", () => {
    useUserSkillStore.setState({
      builtIn: [],
      skills: [
        {
          name: "polish",
          description: "My custom polish",
          body: "…",
          enabled: true,
          source: "manual",
          useCount: 0,
          updatedAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
    render(<SlashCommandMenu query="" onSelect={noop} onClose={noop} />);
    expect(screen.getAllByText("/polish")).toHaveLength(1);
    expect(screen.queryByText("My custom polish")).toBeNull();
  });

  it("reaches the 'Manage skills' footer row via ArrowDown and activates it on Enter", () => {
    const onManageSkills = vi.fn();
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <SlashCommandMenu query="intensity" onSelect={onSelect} onClose={onClose} onManageSkills={onManageSkills} />
    );
    // Two Intensity commands: quieter, bolder — then the footer row.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onManageSkills).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps ArrowUp from the first command back to the 'Manage skills' row", () => {
    const onManageSkills = vi.fn();
    const onClose = vi.fn();
    render(
      <SlashCommandMenu query="intensity" onSelect={noop} onClose={onClose} onManageSkills={onManageSkills} />
    );
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onManageSkills).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a 'Manage skills' footer row that calls onManageSkills and closes", () => {
    const onManageSkills = vi.fn();
    const onClose = vi.fn();
    render(
      <SlashCommandMenu query="" onSelect={noop} onClose={onClose} onManageSkills={onManageSkills} />
    );
    fireEvent.mouseDown(screen.getByTestId("manage-skills-row"));
    expect(onManageSkills).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the 'Manage skills' footer row when onManageSkills is not provided", () => {
    render(<SlashCommandMenu query="" onSelect={noop} onClose={noop} />);
    expect(screen.queryByTestId("manage-skills-row")).toBeNull();
  });
});
