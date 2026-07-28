import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { PwaUpdateGate, AUTO_APPLY_KEY } from "@/components/pwa/PwaUpdateGate";
import { Toaster } from "@/components/ui/sonner";
import { getUpdateSW } from "@/pwa/registerServiceWorker";
import { usePwaStore } from "@/store/pwaStore";

const applyUpdate = vi.fn();

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
  sessionStorage.clear();
  applyUpdate.mockClear();
  vi.mocked(getUpdateSW).mockReturnValue(applyUpdate);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PwaUpdateGate", () => {
  // The showcase holds no unsaved state, so asking permission buys nothing and
  // costs everything: a visitor who never opens the editor has no reason to
  // notice a prompt, and prompt-mode keeps serving the stale bundle until
  // someone clicks it. Apply it for them.
  it("applies the update itself on the showcase route, without prompting", async () => {
    usePwaStore.setState({ updateReady: true });

    renderGate("/");

    await waitFor(() => expect(applyUpdate).toHaveBeenCalledWith(true), IMPORT_TIMEOUT);
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
  });

  // Guard against a reload loop: if the activation didn't take (the update is
  // still waiting on the next load), stop trying and let the visitor decide.
  it("prompts instead when an auto-apply already ran in this tab", async () => {
    sessionStorage.setItem(AUTO_APPLY_KEY, "1");
    usePwaStore.setState({ updateReady: true });

    renderGate("/");

    expect(await screen.findByTestId("pwa-update-toast", undefined, IMPORT_TIMEOUT)).toBeTruthy();
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
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
    // The editor may hold an unsaved document; reloading it out from under the
    // user is not the gate's call to make.
    expect(applyUpdate).not.toHaveBeenCalled();
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
