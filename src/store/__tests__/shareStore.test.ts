import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useShareStore } from "@/store/shareStore";
import { loadShareCredentials, saveShareCredentials, buildShareUrl } from "@/lib/shareCanvas";
import { resetStores } from "@/test/fixtures";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetStores();
  localStorage.clear();
  useShareStore.setState({ status: "idle", shareId: null, shareUrl: null, error: null });
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shareStore", () => {
  it("transitions idle -> sharing -> shared on a successful share", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: "abc", editToken: "tok" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(useShareStore.getState().status).toBe("idle");

    const pending = useShareStore.getState().share();
    expect(useShareStore.getState().status).toBe("sharing");

    await pending;

    expect(useShareStore.getState().status).toBe("shared");
    expect(useShareStore.getState().shareId).toBe("abc");
    expect(useShareStore.getState().shareUrl).toBe(buildShareUrl("abc"));
    expect(useShareStore.getState().error).toBeNull();
  });

  it("transitions idle -> sharing -> error on a failed share", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, {})));

    await useShareStore.getState().share();

    expect(useShareStore.getState().status).toBe("error");
    expect(useShareStore.getState().error).toMatch(/available/i);
  });

  it("reset() clears credentials and returns to idle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "abc", editToken: "tok" })));
    await useShareStore.getState().share();
    expect(loadShareCredentials()).not.toBeNull();

    useShareStore.getState().reset();

    expect(useShareStore.getState().status).toBe("idle");
    expect(useShareStore.getState().shareId).toBeNull();
    expect(useShareStore.getState().shareUrl).toBeNull();
    expect(loadShareCredentials()).toBeNull();
  });

  it("unshare() clears state on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "abc", editToken: "tok" })));
    await useShareStore.getState().share();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await useShareStore.getState().unshare();

    expect(useShareStore.getState().status).toBe("idle");
    expect(useShareStore.getState().shareId).toBeNull();
  });

  // Root-cause fix (see shareCanvas.ts's `subscribeToShareCredentials`):
  // the store must react to ANY `saveShareCredentials` call, not just the
  // ones made through its own share()/unshare()/reset() actions. Without
  // the subscription, a caller like SharedCanvasPage clearing a visitor's
  // credentials before loading someone else's document would leave this
  // store still reporting the visitor's stale link as "shared".
  it("resets to idle when saveShareCredentials(null) is called from outside the store", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "abc", editToken: "tok" })));
    await useShareStore.getState().share();
    expect(useShareStore.getState().status).toBe("shared");

    saveShareCredentials(null);

    expect(useShareStore.getState().status).toBe("idle");
    expect(useShareStore.getState().shareId).toBeNull();
    expect(useShareStore.getState().shareUrl).toBeNull();
  });

  it("adopts 'shared' status when saveShareCredentials(...) is called from outside the store", () => {
    expect(useShareStore.getState().status).toBe("idle");

    saveShareCredentials({ id: "xyz", editToken: "tok" });

    expect(useShareStore.getState().status).toBe("shared");
    expect(useShareStore.getState().shareId).toBe("xyz");
    expect(useShareStore.getState().shareUrl).toBe(buildShareUrl("xyz"));
  });
});
