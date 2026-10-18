// What exactly the agent changed in its own memory / skills. One shared shape
// for both paths that show it: the in-turn `memory` / `skill_manage` tool parts
// (built from the tool INPUT) and the background-review notes (built from the
// `detail` of `GET /api/memory/activity` events). Everything here is pure and
// parses defensively: older backends omit `detail`, and tool input is model
// output.

export type MemoryChange = {
  kind: "memory";
  target: "memory" | "user";
  action: "add" | "replace" | "remove";
  content?: string;
  oldText?: string;
};

export type SkillChangeKind = "create" | "revive" | "patch" | "delete";

export type SkillChange = {
  kind: "skill";
  action: SkillChangeKind;
  name: string;
  description?: string;
  oldString?: string;
  newString?: string;
  absorbedInto?: string;
};

/** Operations the backend cut from an event's detail (it keeps the first 10). */
export type MoreChanges = { kind: "more"; count: number };

export type ChangeDetail = MemoryChange | SkillChange | MoreChanges;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Like `str`, but an empty string is kept: an empty `new_string` is a deletion. */
function strOrEmpty(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const MEMORY_ACTIONS = ["add", "replace", "remove"] as const;
export const SKILL_ACTIONS = ["create", "revive", "patch", "delete"] as const;

/** Memory operations as the `memory` tool takes them (`old_text`) or as the
 * activity endpoint reports them (`oldText`). Unknown shapes are dropped. */
function memoryChanges(target: unknown, operations: unknown): ChangeDetail[] {
  if (!Array.isArray(operations)) return [];
  const t = target === "user" ? "user" : "memory";
  const out: ChangeDetail[] = [];
  for (const op of operations) {
    if (!isRecord(op)) continue;
    const action = MEMORY_ACTIONS.find((a) => a === op.action);
    if (!action) continue;
    out.push({
      kind: "memory",
      target: t,
      action,
      content: str(op.content),
      oldText: str(op.oldText) ?? str(op.old_text),
    });
  }
  return out;
}

/** Changes of a `memory` tool call, from its input. */
export function memoryChangesFromInput(input: unknown): ChangeDetail[] {
  if (!isRecord(input)) return [];
  return memoryChanges(input.target, input.operations);
}

type SkillFields = {
  description?: unknown;
  oldString?: unknown;
  newString?: unknown;
  absorbedInto?: unknown;
};

/** The one builder for a skill change; callers map their key spelling first. */
function buildSkillChange(kind: SkillChangeKind, name: string, f: SkillFields): SkillChange {
  return {
    kind: "skill",
    action: kind,
    name,
    description: str(f.description),
    oldString: str(f.oldString),
    newString: strOrEmpty(f.newString),
    absorbedInto: str(f.absorbedInto),
  };
}

/** The change of a successful `skill_manage` call (snake_case input); `kind`
 * is already resolved (create vs revive) by the caller, who also saw the output. */
export function skillChangeFromInput(
  kind: SkillChangeKind,
  name: string,
  input: unknown,
): ChangeDetail {
  const i = isRecord(input) ? input : {};
  return buildSkillChange(kind, name, {
    description: i.description,
    oldString: i.old_string,
    newString: i.new_string,
    absorbedInto: i.absorbed_into,
  });
}

/** Changes in one activity event's `detail` (camelCase); anything
 * unrecognized gives []. */
export function changesFromEventDetail(detail: unknown): ChangeDetail[] {
  if (!isRecord(detail)) return [];
  if (detail.kind === "memory") {
    const out = memoryChanges(detail.target, detail.operations);
    const more = detail.moreOperations;
    if (typeof more === "number" && Number.isFinite(more) && more > 0) {
      out.push({ kind: "more", count: Math.floor(more) });
    }
    return out;
  }
  if (detail.kind === "skill") {
    const action = SKILL_ACTIONS.find((a) => a === detail.action);
    const name = str(detail.name);
    if (!action || !name) return [];
    return [buildSkillChange(action, name, detail)];
  }
  return [];
}

function withDescription(head: string, description: string | undefined): string {
  return description ? `${head}: ${description}` : head;
}

/** One human line for the expanded row. */
export function formatChange(c: ChangeDetail): string {
  if (c.kind === "more") return `…and ${c.count} more ${c.count === 1 ? "change" : "changes"}`;
  if (c.kind === "memory") {
    const about = c.target === "user" ? " about you" : "";
    switch (c.action) {
      case "add":
        return `Remembered${about}: ${c.content ?? ""}`;
      case "replace":
        return `Updated${about}: ${c.oldText ?? ""} → ${c.content ?? ""}`;
      case "remove":
        return `Forgot${about}: ${c.oldText ?? ""}`;
    }
  }
  switch (c.action) {
    case "create":
      return withDescription(`Created skill ${c.name}`, c.description);
    case "revive":
      return withDescription(`Restored skill ${c.name}`, c.description);
    case "patch": {
      const head = `Updated skill ${c.name}`;
      if (c.oldString && c.newString) return `${head}: ${c.oldString} → ${c.newString}`;
      if (c.oldString && c.newString === "") return `${head}: removed ${c.oldString}`;
      if (c.newString && !c.oldString) return `${head}: added ${c.newString}`;
      return head;
    }
    case "delete":
      return c.absorbedInto
        ? `Deleted skill ${c.name} (merged into ${c.absorbedInto})`
        : `Deleted skill ${c.name}`;
  }
}

/** The flat list a note shows: its events' changes in key order (numeric ids
 * ascending, then id-less events in the order they arrived). */
export function noteChangeList(byEvent: Record<string, ChangeDetail[]> | undefined): ChangeDetail[] {
  return byEvent ? Object.values(byEvent).flat() : [];
}

/** Union of two per-event maps; keys already present win. Returns `existing`
 * itself when nothing is new. */
export function mergeChangesByEvent(
  existing: Record<string, ChangeDetail[]> | undefined,
  incoming: Record<string, ChangeDetail[]> | undefined,
): Record<string, ChangeDetail[]> | undefined {
  const fresh = Object.keys(incoming ?? {}).filter((k) => !existing || !(k in existing));
  if (fresh.length === 0) return existing;
  const out = { ...existing };
  for (const k of fresh) out[k] = incoming![k];
  return out;
}

/** Key of an event within a note: its numeric id, else its own content. */
export function eventKey(id: unknown, changes: ChangeDetail[]): string {
  return typeof id === "number" ? String(id) : `noid:${JSON.stringify(changes)}`;
}
