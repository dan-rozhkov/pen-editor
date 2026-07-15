import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { resetStores } from "@/test/fixtures";
import { useCommandPaletteStore } from "@/store/commandPaletteStore";
import { useDevModeStore } from "@/store/devModeStore";
import { CommandPalette } from "../CommandPalette";

describe("<CommandPalette /> dev-mode guard", () => {
  beforeEach(() => {
    resetStores();
    useDevModeStore.setState({ active: false });
    useCommandPaletteStore.setState({ open: true });
  });

  afterEach(() => cleanup());

  it("lists mutating Edit commands when dev mode is off", () => {
    render(<CommandPalette />);
    expect(screen.getByText("Delete selection")).toBeTruthy();
    expect(screen.getByText("Group selection")).toBeTruthy();
    expect(screen.getByText("Paste")).toBeTruthy();
  });

  it("excludes mutating Edit commands when dev mode is active", () => {
    useDevModeStore.setState({ active: true });
    render(<CommandPalette />);
    expect(screen.queryByText("Delete selection")).toBeNull();
    expect(screen.queryByText("Group selection")).toBeNull();
    expect(screen.queryByText("Ungroup selection")).toBeNull();
    expect(screen.queryByText("Cut")).toBeNull();
    expect(screen.queryByText("Paste")).toBeNull();
    expect(screen.queryByText("Paste properties")).toBeNull();
  });

  it("keeps undo/redo available in dev mode", () => {
    useDevModeStore.setState({ active: true });
    render(<CommandPalette />);
    expect(screen.getByText("Undo")).toBeTruthy();
    expect(screen.getByText("Redo")).toBeTruthy();
  });
});
