import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildShareUrl,
  loadShareCredentials,
  saveShareCredentials,
  shareCurrentCanvas,
  fetchSharedCanvas,
  unshareCurrentCanvas,
  forkSharedCanvasInPlace,
} from "@/lib/shareCanvas";
import { serializeDocument } from "@/utils/fileUtils";
import { useDocumentStore } from "@/store/documentStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import { assertErr, assertOk } from "@/test/assertions";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetStores();
  localStorage.clear();
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildShareUrl", () => {
  it("builds a /c/:id url without a doubled slash", () => {
    const url = buildShareUrl("abc123");
    expect(url).toBe(`${window.location.origin}${import.meta.env.BASE_URL}c/abc123`);
    expect(url).not.toMatch(/\/\/c\//);
  });
});

describe("credentials", () => {
  it("round-trips through localStorage", () => {
    expect(loadShareCredentials()).toBeNull();
    saveShareCredentials({ id: "id1", editToken: "tok1" });
    expect(loadShareCredentials()).toEqual({ id: "id1", editToken: "tok1" });
    saveShareCredentials(null);
    expect(loadShareCredentials()).toBeNull();
  });

  it("treats a corrupt stored value as absent", () => {
    localStorage.setItem("pen.share.current.v1", "not json");
    expect(loadShareCredentials()).toBeNull();
  });
});

describe("shareCurrentCanvas", () => {
  it("creates a share and saves credentials with a url", async () => {
    useDocumentStore.getState().setFileName("My Doc.json");
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { id: "new-id", editToken: "new-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await shareCurrentCanvas();

    expect(result).toEqual({
      ok: true,
      id: "new-id",
      editToken: "new-token",
      url: buildShareUrl("new-id"),
    });
    expect(loadShareCredentials()).toEqual({ id: "new-id", editToken: "new-token" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("My Doc");
    expect(body.shareId).toBeUndefined();
    expect(body.editToken).toBeUndefined();
    expect(typeof body.document).toBe("string");
  });

  it("sends the saved shareId/editToken on a second share", async () => {
    saveShareCredentials({ id: "existing-id", editToken: "existing-token" });
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { id: "existing-id", editToken: "existing-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await shareCurrentCanvas();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.shareId).toBe("existing-id");
    expect(body.editToken).toBe("existing-token");
  });

  it("clears stale credentials and retries as a create on 404", async () => {
    saveShareCredentials({ id: "stale-id", editToken: "stale-token" });
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(404, { error: "not found" });
      return jsonResponse(200, { id: "fresh-id", editToken: "fresh-token" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shareCurrentCanvas();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.shareId).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      id: "fresh-id",
      editToken: "fresh-token",
      url: buildShareUrl("fresh-id"),
    });
    expect(loadShareCredentials()).toEqual({ id: "fresh-id", editToken: "fresh-token" });
  });

  it("maps a 503 to a friendly message and never throws", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await shareCurrentCanvas();

    expect(result).toEqual({
      ok: false,
      error: "Canvas sharing isn't available on this server yet.",
    });
  });

  it("returns a friendly offline error without calling fetch", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await shareCurrentCanvas();

    assertErr(result);
    expect(result.error).toMatch(/offline/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a 413 to a size-limit message naming large images", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(413, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await shareCurrentCanvas();

    assertErr(result);
    expect(result.error).toMatch(/8 MB/);
    expect(result.error).toMatch(/image/i);
  });

  it("never throws on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );

    await expect(shareCurrentCanvas()).resolves.toMatchObject({ ok: false });
  });

  // The backend now sends explicit, human-readable 400 messages (per-owner
  // share cap, shareId/editToken pairing) that aren't about size — those
  // must be shown as-is, not buried behind the generic
  // "Sharing failed (400): ..." wrapper (which the size-limit branch above
  // already special-cases separately).
  it("surfaces the server's own 400 message verbatim instead of the generic wrapper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "Stop sharing an old canvas first." })),
    );

    const result = await shareCurrentCanvas();

    expect(result).toEqual({ ok: false, error: "Stop sharing an old canvas first." });
  });
});

describe("fetchSharedCanvas", () => {
  it("round-trips a document through serializeDocument/deserializeDocument", async () => {
    const document = serializeDocument(
      [{ id: "p1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5" }],
      [],
      "light",
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        id: "shared-1",
        title: "Shared Doc",
        document,
        updatedAt: "2026-08-20T00:00:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSharedCanvas("shared-1");

    assertOk(result);
    expect(result.canvas.id).toBe("shared-1");
    expect(result.canvas.title).toBe("Shared Doc");
    expect(result.canvas.data.pages).toHaveLength(1);
    expect(result.canvas.data.pages[0].id).toBe("p1");
  });

  it("maps a 404 to a friendly message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, {})));
    const result = await fetchSharedCanvas("missing");
    expect(result.ok).toBe(false);
  });
});

describe("unshareCurrentCanvas", () => {
  it("is a no-op success when there are no credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await unshareCurrentCanvas();
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears credentials on success", async () => {
    saveShareCredentials({ id: "id1", editToken: "tok1" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const result = await unshareCurrentCanvas();
    expect(result).toEqual({ ok: true });
    expect(loadShareCredentials()).toBeNull();
  });

  // The backend now takes editToken in the JSON body (a query string leaks
  // the secret into request logs) — assert the frontend actually sends it
  // that way, not as `?editToken=...`.
  it("sends editToken in the JSON request body, not the query string", async () => {
    saveShareCredentials({ id: "id1", editToken: "tok1" });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await unshareCurrentCanvas();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toMatch(/editToken=/);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ editToken: "tok1" });
  });

});

describe("forkSharedCanvasInPlace", () => {
  it("exits view mode, renames the file, and clears share credentials", () => {
    useEditorModeStore.getState().enterView();
    saveShareCredentials({ id: "id1", editToken: "tok1" });

    forkSharedCanvasInPlace("Some Shared Doc");

    expect(useEditorModeStore.getState().mode).toBe("edit");
    expect(useDocumentStore.getState().fileName).toBe("Some Shared Doc (copy)");
    expect(loadShareCredentials()).toBeNull();
  });
});
