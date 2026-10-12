import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloudBrowserConfig", () => ({ useBrowserAgentAvailable: vi.fn(() => true) }));
import { BrowserAgentSettings } from "../BrowserAgentSettings";
import * as cloudConfig from "@/lib/cloudBrowserConfig";
import { useBrowserAgentSettingsStore } from "@/store/browserAgentSettingsStore";

beforeEach(() => {
  vi.mocked(cloudConfig.useBrowserAgentAvailable).mockReturnValue(true);
  useBrowserAgentSettingsStore.setState({ allowPasswordEntry: false, confirmIrreversible: true });
});
afterEach(cleanup);

function openPopover() {
  render(<BrowserAgentSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Browser agent settings" }));
}

describe("<BrowserAgentSettings />", () => {
  it("shows both switches with their default state", async () => {
    openPopover();
    const password = await screen.findByRole("switch", { name: "Allow password entry" });
    const confirm = screen.getByRole("switch", { name: "Confirm irreversible actions" });
    expect(password.getAttribute("aria-checked")).toBe("false");
    expect(confirm.getAttribute("aria-checked")).toBe("true");
  });

  it("toggling a switch updates the store", async () => {
    openPopover();
    fireEvent.click(await screen.findByRole("switch", { name: "Allow password entry" }));
    fireEvent.click(screen.getByRole("switch", { name: "Confirm irreversible actions" }));
    expect(useBrowserAgentSettingsStore.getState().allowPasswordEntry).toBe(true);
    expect(useBrowserAgentSettingsStore.getState().confirmIrreversible).toBe(false);
  });

  it("renders nothing when no browser agent is available", () => {
    vi.mocked(cloudConfig.useBrowserAgentAvailable).mockReturnValue(false);
    const { container } = render(<BrowserAgentSettings />);
    expect(container.firstChild).toBeNull();
  });
});
