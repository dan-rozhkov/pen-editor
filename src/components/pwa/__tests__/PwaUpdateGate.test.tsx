import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { PwaUpdateGate } from "@/components/pwa/PwaUpdateGate";
import { Toaster } from "@/components/ui/sonner";
import { usePwaStore } from "@/store/pwaStore";

const applyUpdate = vi.fn();

vi.mock("@/pwa/registerServiceWorker", () => ({
  getUpdateSW: vi.fn(() => applyUpdate),
}));

// `autoApplyAlreadyTried` is a constant updateSelfHeal.ts reads once from
// sessionStorage at module import time (see that module's comment — it must
// be readable before React ever mounts, so it can't be a hook or a
// useState snapshot). A real re-import per test would need vi.resetModules(),
// which would also hand PwaUpdateGate a second, disconnected copy of `react`
// and `react-router` from the ones MemoryRouter/testing-library already hold
// — two React copies in one render tree breaks hooks outright. Mock the
// module instead, with a mutable getter (`state.autoApplyAlreadyTried`) so
// each test can flip the value without touching the module graph.
const state = vi.hoisted(() => ({ autoApplyAlreadyTried: false }));
vi.mock("@/pwa/updateSelfHeal", () => ({
  get autoApplyAlreadyTried() {
    return state.autoApplyAlreadyTried;
  },
  // Real implementation is a pure string check with no module-load-order
  // concerns, so unlike autoApplyAlreadyTried it doesn't need the mutable
  // getter above — just re-export the actual segment-match logic.
  isEditorPath: (pathname: string) => pathname === "/app" || pathname.startsWith("/app/"),
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
//
// Applying the update itself no longer happens in this component — that
// moved to registerServiceWorker's onNeedRefresh (see
// registerServiceWorker.test.ts and updateSelfHeal.test.ts), so it survives
// even a render that never commits. This gate now only decides whether to
// show the fallback toast.
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
    autoApplyStalled: false,
  });
  sessionStorage.clear();
  applyUpdate.mockClear();
  state.autoApplyAlreadyTried = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PwaUpdateGate", () => {
  // Auto-apply already ran this session (registerServiceWorker's
  // onNeedRefresh) and we're still rendering, so either it's still pending or
  // it silently didn't take — the toast is the fallback path either way.
  it("shows the toast on the showcase once auto-apply has already been tried this session", async () => {
    state.autoApplyAlreadyTried = true;
    usePwaStore.setState({ updateReady: true });

    renderGate("/");

    expect(await screen.findByTestId("pwa-update-toast", undefined, IMPORT_TIMEOUT)).toBeTruthy();
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
  });

  // applyUpdateNow's own stall timer (updateSelfHeal.ts) is the fallback for
  // when autoApplyAlreadyTried never gets a chance to matter — the update
  // fired but the reload it should trigger never arrived. autoApplyStalled
  // is store state (unlike autoApplyAlreadyTried, a session flag read once
  // at import time), so it's exercised directly through usePwaStore rather
  // than the updateSelfHeal mock.
  it("shows the toast on the showcase once the auto-apply stall timer fires", async () => {
    usePwaStore.setState({ updateReady: true, autoApplyStalled: true });

    renderGate("/");

    expect(await screen.findByTestId("pwa-update-toast", undefined, IMPORT_TIMEOUT)).toBeTruthy();
  });

  // Auto-apply hasn't been tried yet this session — give it a chance to work
  // silently (a separate mechanism entirely, not this component) before
  // falling back to a prompt.
  it("stays silent on the showcase before auto-apply has been tried", async () => {
    usePwaStore.setState({ updateReady: true });

    const { container } = renderGate("/");

    await waitFor(() => expect(container.firstChild).toBeNull(), IMPORT_TIMEOUT);
    expect(screen.queryByTestId("pwa-update-toast")).toBeNull();
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
