import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { ModeSwitcher } from "@/components/ModeSwitcher";
import { resetStores } from "@/test/fixtures";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { getCommands, runCommand } from "@/lib/commands/registry";

beforeEach(() => resetStores());
afterEach(cleanup);

function addBrandCollection() {
  const { collections } = useVariableStore.getState();
  useVariableStore.setState({
    collections: [
      ...collections,
      {
        id: "brand",
        name: "Brand",
        modes: [
          { id: "acme", name: "Acme" },
          { id: "globex", name: "Globex" },
        ],
        defaultModeId: "acme",
      },
    ],
  });
}

describe("<ModeSwitcher />", () => {
  it("toggles the Theme mode with a sun/moon button when only Theme has modes", () => {
    render(<ModeSwitcher />);
    const button = screen.getByTestId("mode-switcher-toggle");
    expect(button.getAttribute("aria-label")).toContain("Canvas mode");
    fireEvent.click(button);
    expect(useThemeStore.getState().modeContext.theme).toBe("dark");
    expect(useThemeStore.getState().activeTheme).toBe("dark");
    fireEvent.click(screen.getByTestId("mode-switcher-toggle"));
    expect(useThemeStore.getState().modeContext.theme).toBe("light");
  });

  it("is not an undo step", () => {
    const before = useHistoryStore.getState().getStacks().past.length;
    render(<ModeSwitcher />);
    fireEvent.click(screen.getByTestId("mode-switcher-toggle"));
    expect(useHistoryStore.getState().getStacks().past.length).toBe(before);
  });

  it("lists each multi-mode collection in a popover and writes the picked mode", async () => {
    addBrandCollection();
    render(<ModeSwitcher />);
    fireEvent.click(screen.getByTestId("mode-switcher-trigger"));
    expect(await screen.findByRole("group", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Brand" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Globex" }));
    expect(useThemeStore.getState().modeContext.brand).toBe("globex");
    expect(screen.getByRole("button", { name: "Globex" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("renders nothing when no collection has a choice", () => {
    useVariableStore.setState({ collections: [] });
    const { container } = render(<ModeSwitcher />);
    expect(container.firstChild).toBeNull();
  });
});

describe("view-toggle-canvas-mode command", () => {
  it("flips the Theme mode", () => {
    const command = getCommands().find((c) => c.id === "view-toggle-canvas-mode");
    expect(command).toBeTruthy();
    act(() => runCommand(command!));
    expect(useThemeStore.getState().modeContext.theme).toBe("dark");
  });
});
