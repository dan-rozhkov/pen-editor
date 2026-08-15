import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// The three File -> Export items must route through `runCommand()` (FIR:
// undercounted `document_exported`) rather than calling the export
// functions directly — spy on the real registry module (keep `getCommands`
// real, so the lookup-by-id Toolbar does still resolves) so the export
// side effects (real file downloads) never actually run in this suite.
const { runCommandMock } = vi.hoisted(() => ({ runCommandMock: vi.fn() }));
vi.mock("@/lib/commands/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/commands/registry")>();
  return { ...actual, runCommand: runCommandMock };
});

import { Toolbar } from "../Toolbar";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { usePixelGridStore } from "@/store/pixelGridStore";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";
import { resetStores } from "@/test/fixtures";

/**
 * The Toolbar is the editor's "File" menu: a base-ui dropdown that owns the
 * import/export actions plus a Settings submenu wired to the UI-theme and
 * pixel-grid stores. We assert against those stores' real state.
 *
 * Note: uiThemeStore / pixelGridStore are not reset by resetStores(), and they
 * persist to localStorage. We snapshot their original values once and restore
 * them in afterEach so this suite doesn't leak mutated state to other suites.
 */
describe("<Toolbar />", () => {
  const originalTheme = useUIThemeStore.getState().uiTheme;
  const originalGrid = usePixelGridStore.getState().showPixelGrid;

  beforeEach(() => {
    resetStores();
    // Known baseline for the stores the toolbar drives.
    useUIThemeStore.setState({ uiTheme: "light" });
    usePixelGridStore.setState({ showPixelGrid: true });
  });

  afterEach(() => {
    cleanup();
    useUIThemeStore.setState({ uiTheme: originalTheme });
    usePixelGridStore.setState({ showPixelGrid: originalGrid });
    runCommandMock.mockClear();
  });

  /** Open the top-level File menu and return its menuitem labels. */
  function openFileMenu() {
    fireEvent.click(screen.getByRole("button", { name: /File/i }));
  }

  /** Open File -> Settings submenu (renders the checkbox items). */
  function openSettings() {
    openFileMenu();
    fireEvent.click(screen.getByText("Settings"));
  }

  it("renders the File menu trigger and keeps the menu closed initially", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: /File/i })).toBeTruthy();
    // Menu items live in a portal that only mounts when open.
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("reveals the top-level menu actions when the File menu is opened", () => {
    render(<Toolbar />);
    openFileMenu();

    const labels = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(["Open", "Edit", "Export", "Import", "Settings"]),
    );
  });

  it("places PPTX export under File -> Export", () => {
    render(<Toolbar />);
    openFileMenu();
    fireEvent.click(screen.getByText("Export"));

    expect(screen.getByText("Export as .pptx")).toBeTruthy();
  });

  it("exposes theme + pixel-grid checkboxes whose checked state mirrors the stores", () => {
    render(<Toolbar />);
    openSettings();

    const byLabel = (label: string) =>
      screen
        .getAllByRole("menuitemcheckbox")
        .find((c) => c.textContent === label)!;

    // uiTheme=light, showPixelGrid=true from beforeEach.
    expect(byLabel("Light theme").getAttribute("aria-checked")).toBe("true");
    expect(byLabel("Dark theme").getAttribute("aria-checked")).toBe("false");
    expect(byLabel("Pixel grid").getAttribute("aria-checked")).toBe("true");
  });

  it("shows the MCP bridge status in File -> Settings", () => {
    useMcpBridgeStore.setState({ status: "connected" });
    render(<Toolbar />);
    openSettings();
    expect(screen.getByText("MCP connected")).toBeTruthy();
  });

  it("reports a connecting bridge in File -> Settings", () => {
    useMcpBridgeStore.setState({ status: "connecting" });
    render(<Toolbar />);
    openSettings();
    expect(screen.getByText("MCP connecting\u2026")).toBeTruthy();
  });

  it("still shows a row when no bridge is configured", () => {
    useMcpBridgeStore.setState({ status: "off" });
    render(<Toolbar />);
    openSettings();
    expect(screen.getByText("MCP disconnected")).toBeTruthy();
  });

  it("switches the UI theme to dark when the Dark theme item is clicked", () => {
    render(<Toolbar />);
    openSettings();

    expect(useUIThemeStore.getState().uiTheme).toBe("light");

    const darkItem = screen
      .getAllByRole("menuitemcheckbox")
      .find((c) => c.textContent === "Dark theme")!;
    fireEvent.click(darkItem);

    expect(useUIThemeStore.getState().uiTheme).toBe("dark");
  });

  it("toggles the pixel grid in the store when the Pixel grid item is clicked", () => {
    render(<Toolbar />);
    openSettings();

    expect(usePixelGridStore.getState().showPixelGrid).toBe(true);

    const gridItem = screen
      .getAllByRole("menuitemcheckbox")
      .find((c) => c.textContent === "Pixel grid")!;
    fireEvent.click(gridItem);

    expect(usePixelGridStore.getState().showPixelGrid).toBe(false);
  });

  it("opens the Pixso import dialog from the Import submenu", () => {
    render(<Toolbar />);
    openFileMenu();
    fireEvent.click(screen.getByText("Import"));
    fireEvent.click(screen.getByText("Import from Pixso"));

    // Dialog mounts with its title and the JSON textarea.
    expect(screen.getByText("Import Pixso JSON")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Paste Pixso JSON here..."),
    ).toBeTruthy();
  });

  it("shows a validation error when importing empty JSON", () => {
    render(<Toolbar />);
    openFileMenu();
    fireEvent.click(screen.getByText("Import"));
    fireEvent.click(screen.getByText("Import from Pixso"));

    // Click the dialog's Import button with an empty textarea.
    const importButtons = screen
      .getAllByRole("button")
      .filter((b) => b.textContent === "Import");
    fireEvent.click(importButtons[importButtons.length - 1]);

    expect(screen.getByText("Please paste JSON content")).toBeTruthy();
  });

  it("routes File -> Export as .json through runCommand() with the file-export-json command", () => {
    render(<Toolbar />);
    openFileMenu();
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByText("Export as .json"));

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock.mock.calls[0][0]).toMatchObject({ id: "file-export-json" });
  });

  it("routes File -> Export as .pen through runCommand() with the file-export-pen command", () => {
    render(<Toolbar />);
    openFileMenu();
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByText("Export as .pen"));

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock.mock.calls[0][0]).toMatchObject({ id: "file-export-pen" });
  });

  it("routes File -> Export tokens through runCommand() with the file-export-tokens command", () => {
    render(<Toolbar />);
    openFileMenu();
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByText("Export tokens as .tokens.json"));

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock.mock.calls[0][0]).toMatchObject({ id: "file-export-tokens" });
  });
});
