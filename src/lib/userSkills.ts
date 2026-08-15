// Typed client for user-authored skills (Figma-style "custom skills"),
// plus markdown frontmatter parse/serialize for upload/export.
//
// Backend surface (pen-editor-backend, contract:
// docs/../user-skills-spec.md — see repo root scratch note this was built
// against): user skills are Postgres rows scoped to the anonymous `userId`
// (src/lib/userId.ts's getUserId()), distinct from the git-owned *curated*
// skills (GET /api/skills) and the agent-authored *learned* skills (which
// have no frontend surface at all).
//
//   GET    /api/user-skills?userId=              -> { skills, available }
//   POST   /api/user-skills                      -> 201 { skill }
//   PATCH  /api/user-skills/:name                 -> { skill }
//   DELETE /api/user-skills/:name?userId=         -> { deleted: true }
//   POST   /api/user-skills/generate              -> { draft }
//   GET    /api/skills (curated, unrelated route) -> { skills: BuiltInSkill[] }
//
// Base URL is derived exactly the way useDesignChat.ts / chatModels.ts derive
// the backend base (VITE_AI_API_URL / VITE_DESIGN_AGENT_BACKEND_URL / same
// origin) via apiBase.ts's resolveApiUrl — never a hardcoded "/api".
//
// Every exported function here returns a discriminated-union `ApiResult` and
// NEVER throws — the same "never throws into render" contract as
// showcasePublish.ts / pluginStore.ts. `userSkillStore.ts` is the only
// intended caller; it branches on `.ok` and surfaces `.error` in state.

import { resolveApiUrl } from "@/lib/apiBase";
import { getUserId } from "@/lib/userId";

export type UserSkillSource = "manual" | "upload" | "generated";

/** Wire shape for one user skill (the backend's `PublicUserSkill`). */
export interface UserSkill {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  source: UserSkillSource;
  useCount: number;
  updatedAt: string;
}

/** A curated (git-owned, read-only) skill, as listed by GET /api/skills. */
export interface BuiltInSkill {
  name: string;
  description: string;
}

/** Fields accepted when creating a skill by hand or from an uploaded `.md`.
 * `name`/`description` are optional here because an uploaded file's
 * frontmatter (see parseSkillMarkdown below) may already supply them — the
 * backend 400s if both the frontmatter and this input omit a name. */
export interface CreateUserSkillInput {
  name?: string;
  description?: string;
  body: string;
  source?: UserSkillSource;
}

/** Fields accepted when patching a skill. All optional; omitted fields are
 * left unchanged by the backend. */
export interface UpdateUserSkillPatch {
  newName?: string;
  description?: string;
  body?: string;
  enabled?: boolean;
}

/** What POST /api/user-skills/generate hands back for the user to review and
 * edit before actually persisting it via createUserSkill — generation never
 * saves anything itself. */
export interface UserSkillDraft {
  name: string;
  description: string;
  body: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

async function requestJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), init);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status };
  }

  return { ok: true, data: body as T };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** GET /api/user-skills — this user's own skills. `available: false` means
 * the backend has no store configured (e.g. no TRACE_DATABASE_URL); that is
 * a normal 200, not an error. */
export async function listUserSkills(): Promise<
  ApiResult<{ skills: UserSkill[]; available: boolean }>
> {
  return requestJson(`/api/user-skills?userId=${encodeURIComponent(getUserId())}`);
}

/** GET /api/skills — the curated, git-owned catalog, so the UI can show
 * built-ins alongside the user's own. Unrelated to userId. */
export async function listBuiltInSkills(): Promise<ApiResult<BuiltInSkill[]>> {
  const result = await requestJson<{ skills: BuiltInSkill[] }>("/api/skills");
  if (!result.ok) return result;
  return { ok: true, data: result.data.skills ?? [] };
}

export async function createUserSkill(input: CreateUserSkillInput): Promise<ApiResult<UserSkill>> {
  const result = await requestJson<{ skill: UserSkill }>("/api/user-skills", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ userId: getUserId(), ...input }),
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.skill };
}

export async function updateUserSkill(
  name: string,
  patch: UpdateUserSkillPatch,
): Promise<ApiResult<UserSkill>> {
  const result = await requestJson<{ skill: UserSkill }>(
    `/api/user-skills/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ userId: getUserId(), ...patch }),
    },
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.skill };
}

export async function deleteUserSkill(name: string): Promise<ApiResult<{ deleted: true }>> {
  const url = `/api/user-skills/${encodeURIComponent(name)}?userId=${encodeURIComponent(getUserId())}`;
  return requestJson(url, { method: "DELETE" });
}

/** POST /api/user-skills/generate — asks the agent to draft a skill from a
 * short workflow description. Persists nothing; the caller reviews the
 * draft and then calls createUserSkill itself. */
export async function generateUserSkill(prompt: string): Promise<ApiResult<UserSkillDraft>> {
  const result = await requestJson<{ draft: UserSkillDraft }>("/api/user-skills/generate", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ userId: getUserId(), prompt }),
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.draft };
}

// ---------------------------------------------------------------------------
// Markdown frontmatter parse/serialize, for uploading/exporting a skill as a
// `.md` file. Mirrors the backend's own frontmatter shape (see
// pen-editor-backend src/ai/skills.ts's parseFrontmatter — curated skills use
// the identical `---\nname: x\ndescription: y\n---\nbody` format), kept
// intentionally minimal (name/description only — no args block) since user
// skills don't carry the curated skills' `args` frontmatter field.
// ---------------------------------------------------------------------------

export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse a `.md` file's frontmatter into name/description/body. When there is
 * no `---`-delimited frontmatter block at all, the whole input is treated as
 * the body with an empty name/description — callers (the create form) must
 * then supply name/description themselves, matching the backend's stance
 * that a name is required from *somewhere*. */
export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { name: "", description: "", body: raw.trim() };
  }

  const [, frontmatter, rest] = match;
  let name = "";
  let description = "";
  for (const line of frontmatter.split("\n")) {
    if (line.startsWith("name:")) {
      name = line.slice("name:".length).trim();
    } else if (line.startsWith("description:")) {
      description = line.slice("description:".length).trim();
    }
  }

  return { name, description, body: rest.trim() };
}

/** Inverse of parseSkillMarkdown: render a skill back into a `.md` file with
 * a frontmatter block, for export/download. Round-trips with
 * parseSkillMarkdown (modulo the body's leading/trailing whitespace, which
 * both sides trim). */
export function serializeSkillMarkdown(skill: {
  name: string;
  description: string;
  body: string;
}): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body.trim()}\n`;
}
