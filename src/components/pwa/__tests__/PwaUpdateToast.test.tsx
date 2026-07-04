import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PwaUpdateToast } from "@/components/pwa/PwaUpdateToast";
import { getUpdateSW } from "@/pwa/registerServiceWorker";

vi.mock("@/pwa/registerServiceWorker", () => ({
  getUpdateSW: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PwaUpdateToast", () => {
  it("renders nothing until an update is announced", () => {
    render(<PwaUpdateToast />);
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
  });

  it("shows the toast once pen:pwa-update-ready fires, and applies the update on click", () => {
    const updateSW = vi.fn();
    vi.mocked(getUpdateSW).mockReturnValue(updateSW);

    render(<PwaUpdateToast />);

    fireEvent(window, new CustomEvent("pen:pwa-update-ready"));

    expect(screen.getByTestId("pwa-update-toast")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /update/i }));

    expect(updateSW).toHaveBeenCalledWith(true);
  });
});
