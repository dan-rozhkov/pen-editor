import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserSkillStore } from "@/store/userSkillStore";

vi.mock("@/lib/userId", () => ({
  getUserId: () => "test-user-id",
}));

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

const builtIn = [{ name: "prototype", description: "Build a clickable prototype" }];

function skill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "my-skill",
    description: "desc",
    body: "instructions",
    enabled: true,
    source: "manual" as const,
    useCount: 0,
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  useUserSkillStore.setState({
    skills: [],
    builtIn: [],
    available: true,
    status: "idle",
    error: null,
    pendingUpdates: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Route the mocked fetch by URL, matching listUserSkills (/api/user-skills)
// and listBuiltInSkills (/api/skills) called concurrently by ensureHydrated.
function routeListCalls(userSkills: unknown[], available = true) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/user-skills")) {
      return jsonResponse({ skills: userSkills, available });
    }
    if (url.includes("/api/skills")) {
      return jsonResponse({ skills: builtIn });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("useUserSkillStore ensureHydrated", () => {
  it("starts idle and empty", () => {
    const s = useUserSkillStore.getState();
    expect(s.status).toBe("idle");
    expect(s.skills).toEqual([]);
    expect(s.builtIn).toEqual([]);
  });

  it("hydrates skills and builtIn from the backend", async () => {
    routeListCalls([skill()]);

    await useUserSkillStore.getState().ensureHydrated();

    const s = useUserSkillStore.getState();
    expect(s.status).toBe("ready");
    expect(s.skills).toEqual([skill()]);
    expect(s.builtIn).toEqual(builtIn);
    expect(s.available).toBe(true);
    expect(s.error).toBeNull();
  });

  it("is idempotent: a second call does not refetch once ready", async () => {
    routeListCalls([]);
    await useUserSkillStore.getState().ensureHydrated();
    const callsAfterFirst = fetchMock.mock.calls.length;

    await useUserSkillStore.getState().ensureHydrated();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("dedups concurrent callers into a single request pair", async () => {
    routeListCalls([]);
    const [a, b] = await Promise.all([
      useUserSkillStore.getState().ensureHydrated(),
      useUserSkillStore.getState().ensureHydrated(),
    ]);
    void a;
    void b;
    // One call to /api/user-skills and one to /api/skills, not two of each.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("surfaces a failed user-skills fetch as status: error without throwing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/user-skills")) {
        return jsonResponse({ error: "db unreachable" }, { ok: false, status: 500 });
      }
      return jsonResponse({ skills: builtIn });
    });

    await expect(useUserSkillStore.getState().ensureHydrated()).resolves.toBeUndefined();

    const s = useUserSkillStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("db unreachable");
    expect(s.skills).toEqual([]);
  });

  it("treats a failed built-in fetch as empty + error, not a crash", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/user-skills")) {
        return jsonResponse({ skills: [skill()], available: true });
      }
      throw new TypeError("network down");
    });

    await useUserSkillStore.getState().ensureHydrated();

    const s = useUserSkillStore.getState();
    expect(s.status).toBe("ready");
    expect(s.skills).toEqual([skill()]);
    expect(s.builtIn).toEqual([]);
    expect(s.error).toContain("network down");
  });

  it("a terminal error status is recoverable: the next ensureHydrated call retries", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/user-skills")) {
        return jsonResponse({ error: "down" }, { ok: false, status: 500 });
      }
      return jsonResponse({ skills: builtIn });
    });
    await useUserSkillStore.getState().ensureHydrated();
    expect(useUserSkillStore.getState().status).toBe("error");
    const callsAfterFirst = fetchMock.mock.calls.length;

    routeListCalls([skill()]);
    await useUserSkillStore.getState().ensureHydrated();

    // The retry actually hit the backend again, and this time it succeeded.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    const s = useUserSkillStore.getState();
    expect(s.status).toBe("ready");
    expect(s.skills).toEqual([skill()]);
  });
});

describe("useUserSkillStore refresh", () => {
  it("reloads even when already ready", async () => {
    routeListCalls([]);
    await useUserSkillStore.getState().ensureHydrated();

    routeListCalls([skill({ name: "new-skill" })]);
    await useUserSkillStore.getState().refresh();

    expect(useUserSkillStore.getState().skills).toEqual([skill({ name: "new-skill" })]);
  });
});

describe("useUserSkillStore CRUD", () => {
  it("create adds the returned skill to state on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: skill() }, { status: 201 }));

    const created = await useUserSkillStore.getState().create({ name: "my-skill", body: "instructions" });

    expect(created).toEqual(skill());
    expect(useUserSkillStore.getState().skills).toEqual([skill()]);
    expect(useUserSkillStore.getState().error).toBeNull();
  });

  it("create surfaces the error and returns null on failure, without touching skills", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "already exists" }, { ok: false, status: 409 }),
    );

    const created = await useUserSkillStore.getState().create({ name: "dup", body: "x" });

    expect(created).toBeNull();
    expect(useUserSkillStore.getState().skills).toEqual([]);
    expect(useUserSkillStore.getState().error).toBe("already exists");
  });

  it("update replaces the matching skill by its original name", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    const updated = skill({ description: "new desc", enabled: false });
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: updated }));

    const result = await useUserSkillStore.getState().update("my-skill", { enabled: false, description: "new desc" });

    expect(result).toEqual(updated);
    expect(useUserSkillStore.getState().skills).toEqual([updated]);
  });

  it("update handles a rename by replacing the entry under the new name", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    const renamed = skill({ name: "renamed" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill: renamed }));

    await useUserSkillStore.getState().update("my-skill", { newName: "renamed" });

    expect(useUserSkillStore.getState().skills).toEqual([renamed]);
  });

  it("tracks a per-skill pending write and clears it once the request settles", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    let resolveFetch: (r: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const updatePromise = useUserSkillStore.getState().update("my-skill", { enabled: false });
    expect(useUserSkillStore.getState().pendingUpdates["my-skill"]).toBe(true);

    resolveFetch!(jsonResponse({ skill: skill({ enabled: false }) }));
    await updatePromise;

    expect(useUserSkillStore.getState().pendingUpdates["my-skill"]).toBeUndefined();
  });

  it("clears the pending write even when the update fails", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "conflict" }, { ok: false, status: 409 }));

    await useUserSkillStore.getState().update("my-skill", { enabled: false });

    expect(useUserSkillStore.getState().pendingUpdates["my-skill"]).toBeUndefined();
  });

  it("update surfaces a 404 without mutating skills", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));

    const result = await useUserSkillStore.getState().update("missing", { enabled: false });

    expect(result).toBeNull();
    expect(useUserSkillStore.getState().error).toBe("not found");
    expect(useUserSkillStore.getState().skills).toEqual([skill()]);
  });

  it("remove drops the skill from state on success", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const ok = await useUserSkillStore.getState().remove("my-skill");

    expect(ok).toBe(true);
    expect(useUserSkillStore.getState().skills).toEqual([]);
  });

  it("remove leaves skills untouched and surfaces the error on failure", async () => {
    useUserSkillStore.setState({ skills: [skill()], status: "ready" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));

    const ok = await useUserSkillStore.getState().remove("my-skill");

    expect(ok).toBe(false);
    expect(useUserSkillStore.getState().skills).toEqual([skill()]);
    expect(useUserSkillStore.getState().error).toBe("not found");
  });

  it("generate returns the draft and never mutates skills", async () => {
    const draft = { name: "batch-rename", description: "desc", body: "steps" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ draft }));

    const result = await useUserSkillStore.getState().generate("rename my layers");

    expect(result).toEqual(draft);
    expect(useUserSkillStore.getState().skills).toEqual([]);
  });

  it("generate surfaces a provider failure as ok:false-equivalent (null + error)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "generation failed" }, { ok: false, status: 502 }));

    const result = await useUserSkillStore.getState().generate("do something");

    expect(result).toBeNull();
    expect(useUserSkillStore.getState().error).toBe("generation failed");
  });
});
