import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { PwaUpdateToast } from "@/components/pwa/PwaUpdateToast";
import { getUpdateSW } from "@/pwa/registerServiceWorker";
import { usePwaStore } from "@/store/pwaStore";

vi.mock("@/pwa/registerServiceWorker", () => ({
  getUpdateSW: vi.fn(),
}));

beforeEach(() => {
  usePwaStore.setState({ updateReady: false, offlineReady: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PwaUpdateToast", () => {
  it("renders nothing until an update is announced", () => {
    render(<PwaUpdateToast />);
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
  });

  it("shows the toast once pwaStore reports an update is ready", () => {
    render(<PwaUpdateToast />);

    act(() => usePwaStore.getState().setUpdateReady(true));

    expect(screen.getByTestId("pwa-update-toast")).toBeTruthy();
  });

  it("state set before mount is still shown once the toast mounts (present-mode / mount gaps)", () => {
    // Simulates registerServiceWorker firing while the toast isn't mounted
    // (e.g. present mode, or before App has rendered it at all).
    usePwaStore.setState({ updateReady: true });

    render(<PwaUpdateToast />);

    expect(screen.getByTestId("pwa-update-toast")).toBeTruthy();
  });

  it("stays reflected across unmount/remount, since the state lives in the store, not local state", () => {
    const { unmount } = render(<PwaUpdateToast />);
    act(() => usePwaStore.getState().setUpdateReady(true));
    unmount();

    render(<PwaUpdateToast />);

    expect(screen.getByTestId("pwa-update-toast")).toBeTruthy();
  });

  it("requires a confirm step before reloading, since reloading discards unsaved work", () => {
    const updateSW = vi.fn();
    vi.mocked(getUpdateSW).mockReturnValue(updateSW);
    usePwaStore.setState({ updateReady: true });

    render(<PwaUpdateToast />);

    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    expect(updateSW).not.toHaveBeenCalled();
    expect(screen.getByText(/unsaved work will be lost/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("'Not now' dismisses the toast for the session without applying the update", () => {
    const updateSW = vi.fn();
    vi.mocked(getUpdateSW).mockReturnValue(updateSW);
    usePwaStore.setState({ updateReady: true });

    render(<PwaUpdateToast />);

    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));

    expect(updateSW).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
    expect(usePwaStore.getState().updateReady).toBe(false);
  });
});
