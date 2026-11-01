import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSection } from "../BrowserSection";

const ADS = "Block ads and trackers";
const ASK = "Ask before the agent controls an app";
const MCP = "Let MCP clients control the browser";

const setBridge = (browserSettings?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = browserSettings ? { browserSettings } : {};
};

afterEach(() => {
  cleanup();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("BrowserSection desktop switches", () => {
  it("hides them without the browserSettings bridge", () => {
    setBridge();
    render(<BrowserSection />);
    expect(screen.getByRole("switch", { name: "Record traces for all runs" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: ADS })).toBeNull();
    expect(screen.queryByRole("switch", { name: MCP })).toBeNull();
  });

  it("shows the loaded values and enables the switches after load", async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false }), set: vi.fn() });
    render(<BrowserSection />);
    expect(screen.getByRole("switch", { name: ADS }).hasAttribute("disabled") || screen.getByRole("switch", { name: ADS }).getAttribute("aria-disabled") === "true").toBe(true);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("switch", { name: MCP }).getAttribute("aria-checked")).toBe("false");
  });

  it("calls set with the right patch on toggle", async () => {
    const set = vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: true });
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false }), set });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: MCP }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByRole("switch", { name: MCP }));
    expect(set).toHaveBeenCalledWith({ mcpBrowser: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: MCP }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("switch", { name: ADS }));
    expect(set).toHaveBeenCalledWith({ adBlock: false });
  });

  it("reverts when set fails", async () => {
    const set = vi.fn().mockResolvedValue({ error: "nope" });
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false }), set });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("switch", { name: ADS }));
    await waitFor(() => expect(set).toHaveBeenCalledWith({ adBlock: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
  });

  it("shows the app-access switch only when the shell reports the key", async () => {
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false }), set: vi.fn() });
    const old = render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ADS }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByRole("switch", { name: ASK })).toBeNull();
    old.unmount();

    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false, askAppAccess: false }), set: vi.fn() });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ASK })).toBeTruthy());
    expect(screen.getByRole("switch", { name: ASK }).getAttribute("aria-checked")).toBe("false");
  });

  it("calls set with askAppAccess on toggle", async () => {
    const set = vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false, askAppAccess: true });
    setBridge({ get: vi.fn().mockResolvedValue({ adBlock: true, mcpBrowser: false, askAppAccess: false }), set });
    render(<BrowserSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: ASK })).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: ASK }));
    expect(set).toHaveBeenCalledWith({ askAppAccess: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: ASK }).getAttribute("aria-checked")).toBe("true"));
  });
});
