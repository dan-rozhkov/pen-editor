import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMobbinAuthStore } from "@/store/mobbinAuthStore";
import * as mobbinAuth from "@/lib/mobbinAuth";

const STORAGE_KEYS = [
  "pen.mobbin.clientId",
  "pen.mobbin.accessToken",
  "pen.mobbin.refreshToken",
  "pen.mobbin.expiresAt",
];

function clearStorage() {
  for (const key of STORAGE_KEYS) localStorage.removeItem(key);
}

function storeConnectedTokens() {
  localStorage.setItem("pen.mobbin.clientId", "client-1");
  localStorage.setItem("pen.mobbin.accessToken", "access-1");
  localStorage.setItem("pen.mobbin.refreshToken", "refresh-1");
  localStorage.setItem("pen.mobbin.expiresAt", String(Date.now() + 60 * 60 * 1000));
}

beforeEach(() => {
  clearStorage();
  vi.unstubAllGlobals();
});

// Finding #4: `disconnect()` can be called from deep inside `mobbinAuth.ts`
// (a failed refresh in `getValidAccessToken()`/`withMobbinAuthHeader`'s fetch
// wrapper) with nothing else watching. Before the fix, the store's `status`
// only ever got re-derived on module load or through its own `disconnect`
// action — a disconnect from any other path left the UI reading "connected"
// (Settings menu still offering "Disconnect Mobbin") until a full reload.
describe("mobbinAuthStore — reacts to out-of-band disconnects", () => {
  it("flips to disconnected when mobbinAuth.disconnect() runs outside the store", async () => {
    storeConnectedTokens();
    useMobbinAuthStore.setState({ status: "connected", error: null });

    // Not the store's own `disconnect` action — simulating a call from
    // somewhere inside mobbinAuth.ts itself, e.g. a failed token refresh.
    mobbinAuth.disconnect();

    await vi.waitFor(() => {
      expect(useMobbinAuthStore.getState().status).toBe("disconnected");
    });
  });

  it("does not affect a store still legitimately connected elsewhere", async () => {
    // Sanity check the subscription doesn't fire on unrelated store writes.
    storeConnectedTokens();
    useMobbinAuthStore.setState({ status: "connected", error: null });

    useMobbinAuthStore.setState({ error: "unrelated transient error" });

    expect(useMobbinAuthStore.getState().status).toBe("connected");
  });
});

// Defect: `refreshStatus()` set `status` unconditionally, and the
// out-of-band subscription above calls it on ANY `mobbinAuth.disconnect()`
// — including one triggered by a completely unrelated request's failed
// token refresh while THIS tab's own `connect()` popup is still open. That
// overwrote "connecting" with "disconnected" mid-flow, re-enabling
// "Connect Mobbin…"; a second click would reuse the named "mobbin-oauth"
// popup window and tear down the authorization already in progress.
describe("mobbinAuthStore — refreshStatus never clobbers an in-flight connect()", () => {
  it("leaves status as 'connecting' when an out-of-band disconnect fires mid-flow", async () => {
    useMobbinAuthStore.setState({ status: "connecting", error: null });
    // No credentials stored — matches the real scenario, where disconnect()
    // has just cleared them elsewhere.
    clearStorage();

    // Simulate the out-of-band trigger directly: any disconnect() call
    // notifies subscribers, which call refreshStatus().
    mobbinAuth.disconnect();

    // Give the async refreshStatus() a chance to resolve and (if unguarded)
    // clobber the status.
    await vi.waitFor(() => {
      expect(useMobbinAuthStore.getState().status).toBe("connecting");
    });
    // Assert it stays "connecting" for a bit longer too, not just on the
    // first tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useMobbinAuthStore.getState().status).toBe("connecting");
  });

  it("still updates status normally when not mid-connect", async () => {
    storeConnectedTokens();
    useMobbinAuthStore.setState({ status: "connected", error: null });

    mobbinAuth.disconnect();

    await vi.waitFor(() => {
      expect(useMobbinAuthStore.getState().status).toBe("disconnected");
    });
  });
});
