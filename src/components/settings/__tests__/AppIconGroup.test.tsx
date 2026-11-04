import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppIconGroup } from "../AppIconGroup";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const PNG = "data:image/png;base64,AAAA";
const state = (selected: string) => ({
  selected,
  options: [
    { id: "dark", label: "Dark", preview: PNG },
    { id: "light", label: "Light", preview: PNG },
    { id: "bad", label: "Broken", preview: "https://example.com/x.png" },
  ],
});

const setBridge = (appIcon?: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = appIcon ? { appIcon } : {};
};

afterEach(() => {
  cleanup();
  toastError.mockReset();
  vi.restoreAllMocks();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("AppIconGroup", () => {
  it("renders nothing without the bridge", () => {
    setBridge();
    const { container } = render(<AppIconGroup />);
    expect(container.innerHTML).toBe("");
  });

  it("renders valid options with the selected one checked", async () => {
    setBridge({ get: vi.fn().mockResolvedValue(state("dark")), set: vi.fn() });
    render(<AppIconGroup />);
    const dark = await screen.findByRole("radio", { name: "Dark" });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("radio", { name: "Broken" })).toBeNull();
    expect(screen.getByText("App icon")).toBeTruthy();
  });

  it("calls set and applies the returned state", async () => {
    const set = vi.fn().mockResolvedValue(state("light"));
    setBridge({ get: vi.fn().mockResolvedValue(state("dark")), set });
    render(<AppIconGroup />);
    fireEvent.click(await screen.findByRole("radio", { name: "Light" }));
    expect(set).toHaveBeenCalledWith("light");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("keeps the selection and toasts when set fails", async () => {
    const set = vi.fn().mockResolvedValue({ error: "nope" });
    setBridge({ get: vi.fn().mockResolvedValue(state("dark")), set });
    render(<AppIconGroup />);
    fireEvent.click(await screen.findByRole("radio", { name: "Light" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not change the app icon."));
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
  });

  it("renders nothing and warns when get returns an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const get = vi.fn().mockResolvedValue({ error: "boom" });
    setBridge({ get, set: vi.fn() });
    const { container } = render(<AppIconGroup />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
