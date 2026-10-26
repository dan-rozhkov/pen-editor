import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import SettingsPage from "../SettingsPage";
import { BROWSE_TRACES_KEY } from "@/lib/browseTracePref";
import { SETTINGS_SECTION_EVENT } from "@/lib/openSettings";
import { usePixelGridStore } from "@/store/pixelGridStore";
import { useUIThemeStore } from "@/store/uiThemeStore";

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function renderSettings(url = "/settings") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/settings"
          element={
            <>
              <SettingsPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  useUIThemeStore.setState({ uiTheme: "light" });
  usePixelGridStore.setState({ showPixelGrid: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<SettingsPage />", () => {
  it("renders the Appearance section by default and sets the document title", () => {
    renderSettings();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
    expect(document.title).toBe("Settings");
    expect(document.documentElement.classList.contains("route-settings")).toBe(true);
  });

  it("lists the sections in nav order", () => {
    renderSettings();
    const names = within(screen.getByRole("navigation", { name: "Settings sections" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      "Account",
      "Appearance",
      "Canvas",
      "AI agent",
      "Agent memory",
      "Skills",
      "Browser",
      "Integrations",
      "Data & privacy",
      "Advanced",
      "Keyboard shortcuts",
    ]);
  });

  it("falls back to Appearance for an unknown section", () => {
    renderSettings("/settings?section=nope");
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
  });

  it("switching the nav updates ?section= and keeps other params", () => {
    renderSettings("/settings?chat=off");
    fireEvent.click(screen.getByRole("button", { name: "Canvas" }));
    expect(screen.getByRole("heading", { level: 2, name: "Canvas" })).toBeTruthy();
    const where = screen.getByTestId("where").textContent;
    expect(where).toContain("section=canvas");
    expect(where).toContain("chat=off");
  });

  it("follows openSettings(section) while the page is showing", () => {
    renderSettings();
    act(() => {
      window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EVENT, { detail: "shortcuts" }));
    });
    expect(screen.getByRole("heading", { level: 2, name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("follows the desktop shell's in-place section switch and unsubscribes on unmount", () => {
    let push: (section: string) => void = () => undefined;
    const off = vi.fn();
    window.penDesktop = {
      settings: {
        onSection: (cb: (section: string) => void) => {
          push = cb;
          return off;
        },
      },
      onMenuCommand: () => () => undefined,
    };
    try {
      const view = renderSettings();
      act(() => push("canvas"));
      expect(screen.getByRole("heading", { level: 2, name: "Canvas" })).toBeTruthy();
      act(() => push("bogus"));
      expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
      view.unmount();
      expect(off).toHaveBeenCalled();
    } finally {
      delete window.penDesktop;
    }
  });

  it("clicking a theme card sets the theme as a user choice", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(useUIThemeStore.getState().uiTheme).toBe("dark");
    expect(localStorage.getItem("ui-theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
  });

  it("the Pixel grid switch toggles the store", () => {
    renderSettings("/settings?section=canvas");
    const toggle = screen.getByRole("switch", { name: "Pixel grid" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(usePixelGridStore.getState().showPixelGrid).toBe(false);
  });

  it("lists shortcuts and filters them by label", async () => {
    renderSettings("/settings?section=shortcuts");
    expect(await screen.findByText("Toggle rulers")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search shortcuts" }), { target: { value: "zzzz-none" } });
    expect(screen.getByText("No shortcuts match.")).toBeTruthy();
  });

  it("Browser section: the browser-trace switch toggles the browse-traces key", () => {
    renderSettings("/settings?section=browser");
    expect(screen.getByRole("heading", { level: 2, name: "Browser" })).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Record traces for all runs" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBe("all");
    expect(screen.getByRole("switch", { name: "Record traces for all runs" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Record traces for all runs" }));
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBeNull();
  });
});
