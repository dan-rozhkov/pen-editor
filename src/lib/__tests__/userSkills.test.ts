import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listUserSkills,
  listBuiltInSkills,
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  generateUserSkill,
  parseSkillMarkdown,
  serializeSkillMarkdown,
} from "@/lib/userSkills";
import { assertErr } from "@/test/assertions";

const USER_ID = "test-user-id";

vi.mock("@/lib/userId", () => ({
  getUserId: () => USER_ID,
}));

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listUserSkills", () => {
  it("fetches GET /api/user-skills with the userId query param", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ skills: [], available: true }),
    );

    const result = await listUserSkills();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/user-skills");
    expect(url).toContain(`userId=${USER_ID}`);
    expect(result).toEqual({ ok: true, data: { skills: [], available: true } });
  });

  it("surfaces available: false without treating it as an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ skills: [], available: false }));
    const result = await listUserSkills();
    expect(result).toEqual({ ok: true, data: { skills: [], available: false } });
  });

  it("returns ok:false with the server error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "invalid userId" }, { ok: false, status: 400 }),
    );
    const result = await listUserSkills();
    expect(result).toEqual({ ok: false, error: "invalid userId", status: 400 });
  });

  it("returns ok:false on a network failure, never throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await listUserSkills();
    assertErr(result);
    expect(result.error).toContain("Failed to fetch");
  });
});

describe("listBuiltInSkills", () => {
  it("fetches GET /api/skills and unwraps the skills array", async () => {
    const skills = [{ name: "prototype", description: "Build a clickable prototype" }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ skills }));

    const result = await listBuiltInSkills();

    expect(fetchMock.mock.calls[0][0]).toContain("/api/skills");
    expect(result).toEqual({ ok: true, data: skills });
  });

  it("returns ok:false on failure rather than crashing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const result = await listBuiltInSkills();
    expect(result.ok).toBe(false);
  });
});

describe("createUserSkill", () => {
  it("POSTs with the userId merged into the body and unwraps the skill", async () => {
    const skill = {
      name: "my-skill",
      description: "desc",
      body: "instructions",
      enabled: true,
      source: "manual" as const,
      useCount: 0,
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill }, { status: 201 }));

    const result = await createUserSkill({ name: "my-skill", description: "desc", body: "instructions" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/user-skills");
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({
      userId: USER_ID,
      name: "my-skill",
      description: "desc",
      body: "instructions",
    });
    expect(result).toEqual({ ok: true, data: skill });
  });

  it("returns ok:false with the message on a 409 name collision", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "a skill named \"my-skill\" already exists" }, { ok: false, status: 409 }),
    );
    const result = await createUserSkill({ name: "my-skill", body: "x" });
    assertErr(result);
    expect(result.status).toBe(409);
    expect(result.error).toContain("already exists");
  });
});

describe("updateUserSkill", () => {
  it("PATCHes the name-scoped URL with the userId merged into the body", async () => {
    const skill = {
      name: "renamed",
      description: "desc",
      body: "instructions",
      enabled: false,
      source: "manual" as const,
      useCount: 2,
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ skill }));

    const result = await updateUserSkill("my-skill", { newName: "renamed", enabled: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/user-skills/my-skill");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      userId: USER_ID,
      newName: "renamed",
      enabled: false,
    });
    expect(result).toEqual({ ok: true, data: skill });
  });

  it("URL-encodes a name containing special characters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));
    await updateUserSkill("weird name/x", { enabled: true });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent("weird name/x"));
  });
});

describe("deleteUserSkill", () => {
  it("DELETEs the name-scoped URL with the userId query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    const result = await deleteUserSkill("my-skill");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/user-skills/my-skill");
    expect(url).toContain(`userId=${USER_ID}`);
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ ok: true, data: { deleted: true } });
  });

  it("returns ok:false on a 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { ok: false, status: 404 }));
    const result = await deleteUserSkill("missing");
    expect(result).toEqual({ ok: false, error: "not found", status: 404 });
  });
});

describe("generateUserSkill", () => {
  it("POSTs the prompt and unwraps the draft without persisting anything", async () => {
    const draft = { name: "batch-rename", description: "Rename layers", body: "1. Do X" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ draft }));

    const result = await generateUserSkill("rename my layers sequentially");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/user-skills/generate");
    expect(JSON.parse(init.body)).toEqual({
      userId: USER_ID,
      prompt: "rename my layers sequentially",
    });
    expect(result).toEqual({ ok: true, data: draft });
  });

  it("returns ok:false (502-shaped) on a provider error rather than throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "generation failed" }, { ok: false, status: 502 }),
    );
    const result = await generateUserSkill("do something");
    expect(result).toEqual({ ok: false, error: "generation failed", status: 502 });
  });
});

describe("parseSkillMarkdown / serializeSkillMarkdown", () => {
  it("parses name/description frontmatter and the body", () => {
    const raw = "---\nname: my-skill\ndescription: Does a thing\n---\n\nStep 1. Do the thing.\n";
    const parsed = parseSkillMarkdown(raw);
    expect(parsed).toEqual({
      name: "my-skill",
      description: "Does a thing",
      body: "Step 1. Do the thing.",
    });
  });

  it("treats markdown with no frontmatter as body-only", () => {
    const parsed = parseSkillMarkdown("Just some instructions, no frontmatter.");
    expect(parsed).toEqual({
      name: "",
      description: "",
      body: "Just some instructions, no frontmatter.",
    });
  });

  it("round-trips name/description/body through serialize -> parse", () => {
    const skill = {
      name: "batch-rename",
      description: "Renames the selection sequentially",
      body: "1. Read the selection\n2. Rename each node in order",
    };
    const md = serializeSkillMarkdown(skill);
    const parsed = parseSkillMarkdown(md);
    expect(parsed).toEqual(skill);
  });

  it("round-trips parse -> serialize -> parse for arbitrary raw input", () => {
    const raw = "---\nname: x\ndescription: y\n---\nbody line one\nbody line two";
    const first = parseSkillMarkdown(raw);
    const second = parseSkillMarkdown(serializeSkillMarkdown(first));
    expect(second).toEqual(first);
  });
});
