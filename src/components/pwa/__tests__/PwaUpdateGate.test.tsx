import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { PwaUpdateGate } from "@/components/pwa/PwaUpdateGate";
import { Toaster } from "@/components/ui/sonner";
import { usePwaStore } from "@/store/pwaStore";

vi.mock("@/pwa/registerServiceWorker", () => ({
  getUpdateSW: vi.fn(),
}));

// The gate pulls its toast + sonner portal in through lazy() dynamic imports.
// Import them here too so those chunks are already in the module cache when a
// test renders: a cold dynamic import inside the full suite can take longer
// than the queries wait, which made this file pass alone and fail in `npm
// test`. The generous timeout covers the remaining microtask hop.
await import("@/components/pwa/PwaUpdateToast");
await import("@/components/ui/ToasterBase");

const IMPORT_TIMEOUT = { timeout: 5000 };

// The gate is the fix for a real regression: when the showcase took over "/"
// and the editor moved to "/app", the update toast stayed mounted inside the
// editor's App — so an update detected while the user was on the showcase set
// pwaStore.updateReady and then rendered nowhere. The gate lives above the
// route split and brings its own sonner portal when the editor isn't there.
function renderGate(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PwaUpdateGate />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  usePwaStore.setState({
    updateReady: false,
    offlineReady: false,
    toastSuppressed: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PwaUpdateGate", () => {
  it("shows the update toast on the showcase route, which mounts no editor", async () => {
    usePwaStore.setState({ updateReady: true });

    renderGate("/");

    expect(await screen.findByTestId("pwa-update-toast", undefined, IMPORT_TIMEOUT)).toBeTruthy();
  });

  it("shows the update toast on the editor route, reusing App's portal", async () => {
    usePwaStore.setState({ updateReady: true });

    // On "/app" the gate deliberately brings no <Toaster /> of its own —
    // App mounts one, and two portals would render every toast twice.
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Toaster />
        <PwaUpdateGate />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("pwa-update-toast", undefined, IMPORT_TIMEOUT)).toBeTruthy();
  });

  it("brings exactly one toast portal on the showcase route", async () => {
    usePwaStore.setState({ updateReady: true });

    renderGate("/");
    await screen.findByTestId("pwa-update-toast", undefined, IMPORT_TIMEOUT);

    expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
    expect(screen.getAllByTestId("pwa-update-toast")).toHaveLength(1);
  });

  it("stays silent — and loads nothing — while no update is waiting", async () => {
    const { container } = renderGate("/");

    await waitFor(() => expect(container.firstChild).toBeNull(), IMPORT_TIMEOUT);
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
  });

  it("stays silent while the editor suppresses toasts (present mode)", async () => {
    usePwaStore.setState({ updateReady: true, toastSuppressed: true });

    renderGate("/app");

    await waitFor(
      () => expect(screen.queryByTestId("pwa-update-toast")).toBeNull(),
      IMPORT_TIMEOUT,
    );
  });
});
