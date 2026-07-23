import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPrototypeLinks } from "../prototypeApi";

afterEach(() => vi.restoreAllMocks());

describe("fetchPrototypeLinks", () => {
  it("POSTs screens and returns links", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ links: [{ screenId: "a", protoId: "p0", targetScreenId: "b" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const links = await fetchPrototypeLinks([
      { id: "a", name: "Login", candidates: [] },
      { id: "b", name: "Dashboard", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "a", protoId: "p0", targetScreenId: "b" }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    await expect(fetchPrototypeLinks([{ id: "a", name: "A", candidates: [] }])).rejects.toThrow();
  });
});
