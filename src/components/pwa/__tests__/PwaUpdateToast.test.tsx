import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { Toaster } from "@/components/ui/sonner";
import { PwaUpdateToast } from "@/components/pwa/PwaUpdateToast";
import { getUpdateSW } from "@/pwa/registerServiceWorker";
import { usePwaStore } from "@/store/pwaStore";

vi.mock("@/pwa/registerServiceWorker", () => ({
  getUpdateSW: vi.fn(),
}));

// PwaUpdateToast is headless — it fires a sonner toast into the portal that a
// <Toaster /> renders. Mount both together, exactly as App.tsx does.
function renderToast() {
  return render(
    <>
      <Toaster />
      <PwaUpdateToast />
    </>,
  );
}

beforeEach(() => {
  usePwaStore.setState({ updateReady: false, offlineReady: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PwaUpdateToast", () => {
  it("renders nothing until an update is announced", () => {
    renderToast();
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
  });

  it("shows the toast once pwaStore reports an update is ready", async () => {
    renderToast();

    act(() => usePwaStore.getState().setUpdateReady(true));

    expect(await screen.findByTestId("pwa-update-toast")).toBeTruthy();
  });

  it("state set before mount is still shown once the toast mounts (present-mode / mount gaps)", async () => {
    // Simulates registerServiceWorker firing while the toast isn't mounted
    // (e.g. present mode, or before App has rendered it at all).
    usePwaStore.setState({ updateReady: true });

    renderToast();

    expect(await screen.findByTestId("pwa-update-toast")).toBeTruthy();
  });

  it("reloads immediately on the first Update click — no confirm step", async () => {
    const updateSW = vi.fn();
    vi.mocked(getUpdateSW).mockReturnValue(updateSW);
    usePwaStore.setState({ updateReady: true });

    renderToast();
    await screen.findByTestId("pwa-update-toast");

    fireEvent.click(screen.getByRole("button", { name: /update/i }));

    // A single click applies the update — there is no "unsaved work" confirm.
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(screen.queryByText(/unsaved work/i)).toBeNull();
  });

  it("dismissing clears updateReady without applying the update", async () => {
    const updateSW = vi.fn();
    vi.mocked(getUpdateSW).mockReturnValue(updateSW);
    usePwaStore.setState({ updateReady: true });

    renderToast();
    await screen.findByTestId("pwa-update-toast");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() =>
      expect(usePwaStore.getState().updateReady).toBe(false),
    );
    expect(updateSW).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId("pwa-update-toast")).toBeNull(),
    );
  });
});
