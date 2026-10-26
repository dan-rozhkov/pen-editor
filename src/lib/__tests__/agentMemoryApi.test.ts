import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAgentMemory, deleteMemoryEntry, fetchAgentMemory, setAgentMemoryEnabled } from "../agentMemoryApi";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("agentMemoryApi", () => {
  it("fetches and normalizes memory with the userId in the query", async () => {
    const f = vi.fn(async () => json({ available: true, enabled: false, memory: ["a"], user: ["b"], limits: { memory: 10, user: 5 } }));
    vi.stubGlobal("fetch", f);
    const res = await fetchAgentMemory();
    expect(res).toEqual({
      ok: true,
      data: { available: true, enabled: false, memory: ["a"], user: ["b"], limits: { memory: 10, user: 5 } },
    });
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(url).toMatch(/^\/api\/memory\?userId=/);
  });

  it("sends target and text on entry delete and reports 404", async () => {
    const f = vi.fn(async () => json({ error: "not found" }, 404));
    vi.stubGlobal("fetch", f);
    const res = await deleteMemoryEntry("user", "likes tea");
    expect(res).toMatchObject({ ok: false, status: 404, error: "not found" });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ target: "user", text: "likes tea" });
  });

  it("clears and toggles", async () => {
    const f = vi.fn(async (url: string) =>
      String(url).includes("/settings") ? json({ enabled: true }) : json({ cleared: { memory: 1, user: 2 } }),
    );
    vi.stubGlobal("fetch", f);
    expect(await clearAgentMemory()).toEqual({ ok: true, data: { cleared: { memory: 1, user: 2 } } });
    expect(await setAgentMemoryEnabled(true)).toEqual({ ok: true, data: { enabled: true } });
    const init = (f.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
  });

  it("turns a network failure into an error result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchAgentMemory()).toEqual({ ok: false, error: "offline" });
  });
});
