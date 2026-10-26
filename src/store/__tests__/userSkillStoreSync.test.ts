import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/userId", () => ({ getUserId: () => "test-user-id" }));

// A same-process BroadcastChannel: delivers to OTHER instances of the name.
const instances = new Set<FakeChannel>();
class FakeChannel {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  name: string;
  constructor(name: string) {
    this.name = name;
    instances.add(this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
    for (const c of instances) if (c !== this && c.name === this.name) c.onmessage?.({ data });
  }
  close() {
    instances.delete(this);
  }
}

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const sk = (name: string) => ({ name, description: "d", body: "b", enabled: true, source: "manual", useCount: 0, updatedAt: "x" });

let fetchMock: ReturnType<typeof vi.fn>;
let server: unknown[];

async function freshStore() {
  vi.resetModules();
  const { useUserSkillStore } = await import("../userSkillStore");
  return useUserSkillStore;
}

beforeEach(() => {
  instances.clear();
  server = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const s = sk("made");
      server = [s];
      return json({ skill: s }, 201);
    }
    if (String(url).includes("/api/user-skills")) return json({ skills: server, available: true });
    return json({ skills: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("userSkillStore cross-document sync", () => {
  it("re-fetches in a hydrated document after a write elsewhere, without echoing", async () => {
    const writer = await freshStore();
    const reader = await freshStore();
    await reader.getState().ensureHydrated();
    expect(reader.getState().skills).toEqual([]);

    await writer.getState().create({ name: "made", body: "b" });
    await vi.waitFor(() => expect(reader.getState().skills.map((s) => s.name)).toEqual(["made"]));

    const posts = [...instances].flatMap((c) => c.posted);
    expect(posts).toHaveLength(1); // only the write posted; the re-fetch did not
  });

  it("ignores messages in a document that never hydrated", async () => {
    const writer = await freshStore();
    const idle = await freshStore();
    await writer.getState().create({ name: "made", body: "b" });
    await new Promise((r) => setTimeout(r, 10));
    expect(idle.getState().status).toBe("idle");
  });

  it("works without BroadcastChannel", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const store = await freshStore();
    expect(await store.getState().create({ name: "made", body: "b" })).not.toBeNull();
  });

  describe("silent refresh", () => {
    const deferred = () => {
      let resolve!: (r: Response) => void;
      const promise = new Promise<Response>((r) => (resolve = r));
      return { promise, resolve };
    };
    const isListGet = (url: string, init?: RequestInit) => String(url).includes("/api/user-skills") && init?.method !== "POST";

    it("(a) does not flip status to loading and coalesces overlapping messages", async () => {
      const reader = await freshStore();
      await reader.getState().ensureHydrated();
      const statuses: string[] = [];
      reader.subscribe((s) => statuses.push(s.status));
      const gates: Array<ReturnType<typeof deferred>> = [];
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (isListGet(url, init)) {
          const d = deferred();
          gates.push(d);
          return d.promise;
        }
        return Promise.resolve(json({ skills: [] }));
      });
      const ch = new FakeChannel("pen.userSkills");
      ch.postMessage({ type: "changed" });
      ch.postMessage({ type: "changed" });
      ch.postMessage({ type: "changed" });
      expect(reader.getState().status).toBe("ready");
      expect(gates).toHaveLength(1); // one in flight
      gates[0].resolve(json({ skills: [sk("one")], available: true }));
      await vi.waitFor(() => expect(gates).toHaveLength(2)); // exactly one more run
      gates[1].resolve(json({ skills: [sk("one"), sk("two")], available: true }));
      await vi.waitFor(() => expect(reader.getState().skills.map((x) => x.name)).toEqual(["one", "two"]));
      expect(gates).toHaveLength(2);
      expect(statuses).not.toContain("loading");
    });

    it("(b) keeps the loaded list when the refresh fails", async () => {
      const reader = await freshStore();
      server = [sk("keep")];
      await reader.getState().ensureHydrated();
      expect(reader.getState().skills).toHaveLength(1);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      fetchMock.mockImplementation(async () => json({ error: "boom" }, 500));
      await reader.getState().refreshFromRemote();
      const s = reader.getState();
      expect(s.skills.map((x) => x.name)).toEqual(["keep"]);
      expect(s.available).toBe(true);
      expect(s.status).toBe("ready");
      expect(s.error).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("(c) drops a refresh that began before a local write", async () => {
      const store = await freshStore();
      await store.getState().ensureHydrated();
      const gate = deferred();
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "POST") return Promise.resolve(json({ skill: sk("made") }, 201));
        if (isListGet(url, init)) return gate.promise;
        return Promise.resolve(json({ skills: [] }));
      });
      const refreshing = store.getState().refreshFromRemote();
      await store.getState().create({ name: "made", body: "b" });
      gate.resolve(json({ skills: [], available: true })); // stale snapshot, taken before the write
      await refreshing;
      expect(store.getState().skills.map((x) => x.name)).toEqual(["made"]);
    });
  });
});
