import { describe, it, expect } from "vitest";
import {
  changesFromEventDetail,
  formatChange,
  memoryChangesFromInput,
  skillChangeFromInput,
  type ChangeDetail,
} from "../memoryActivity";

const mem = (c: Partial<Extract<ChangeDetail, { kind: "memory" }>>): ChangeDetail => ({
  kind: "memory",
  target: "memory",
  action: "add",
  ...c,
});
const skill = (c: Partial<Extract<ChangeDetail, { kind: "skill" }>>): ChangeDetail => ({
  kind: "skill",
  action: "create",
  name: "s",
  ...c,
});

describe("formatChange", () => {
  it.each<[string, ChangeDetail, string]>([
    ["memory add", mem({ content: "A" }), "Remembered: A"],
    ["user add", mem({ target: "user", content: "A" }), "Remembered about you: A"],
    ["memory replace", mem({ action: "replace", oldText: "A", content: "B" }), "Updated: A → B"],
    ["user replace", mem({ target: "user", action: "replace", oldText: "A", content: "B" }), "Updated about you: A → B"],
    ["memory remove", mem({ action: "remove", oldText: "A" }), "Forgot: A"],
    ["user remove", mem({ target: "user", action: "remove", oldText: "A" }), "Forgot about you: A"],
    ["skill create", skill({ description: "D" }), "Created skill s: D"],
    ["skill create, no description", skill({}), "Created skill s"],
    ["skill revive", skill({ action: "revive", description: "D" }), "Restored skill s: D"],
    ["skill patch", skill({ action: "patch", oldString: "a", newString: "b" }), "Updated skill s: a → b"],
    ["skill patch, deletion", skill({ action: "patch", oldString: "a", newString: "" }), "Updated skill s: removed a"],
    ["skill patch, addition", skill({ action: "patch", newString: "b" }), "Updated skill s: added b"],
    ["more operations", { kind: "more", count: 3 }, "…and 3 more changes"],
    ["skill patch, no strings", skill({ action: "patch" }), "Updated skill s"],
    ["skill delete", skill({ action: "delete" }), "Deleted skill s"],
    ["skill delete, merged", skill({ action: "delete", absorbedInto: "t" }), "Deleted skill s (merged into t)"],
  ])("%s", (_n, change, line) => {
    expect(formatChange(change)).toBe(line);
  });
});

describe("parsing", () => {
  it("reads memory tool input (old_text) and drops malformed operations", () => {
    expect(
      memoryChangesFromInput({
        target: "user",
        operations: [{ action: "remove", old_text: "x" }, { action: "bogus" }, null],
      }),
    ).toEqual([mem({ target: "user", action: "remove", oldText: "x", content: undefined })]);
    expect(memoryChangesFromInput("nope")).toEqual([]);
  });

  it("reads event details of both kinds and ignores unknown shapes", () => {
    expect(
      changesFromEventDetail({ kind: "memory", target: "memory", operations: [{ action: "add", content: "c" }] }),
    ).toHaveLength(1);
    expect(changesFromEventDetail({ kind: "skill", action: "patch", name: "n", oldString: "a", newString: "b" })).toEqual([
      skill({ action: "patch", name: "n", oldString: "a", newString: "b" }),
    ]);
    for (const bad of [undefined, null, 3, {}, { kind: "skill", action: "x", name: "n" }, { kind: "skill", action: "patch" }]) {
      expect(changesFromEventDetail(bad)).toEqual([]);
    }
  });

  it("keeps an empty new string (a deletion) on both paths", () => {
    const want = skill({ action: "patch", name: "n", oldString: "a", newString: "" });
    expect(skillChangeFromInput("patch", "n", { old_string: "a", new_string: "" })).toEqual(want);
    expect(changesFromEventDetail({ kind: "skill", action: "patch", name: "n", oldString: "a", newString: "" })).toEqual([want]);
  });

  it("appends a 'more' entry for moreOperations", () => {
    const out = changesFromEventDetail({
      kind: "memory",
      target: "memory",
      operations: [{ action: "add", content: "c" }],
      moreOperations: 4,
    });
    expect(out.map(formatChange)).toEqual(["Remembered: c", "…and 4 more changes"]);
    expect(changesFromEventDetail({ kind: "memory", target: "memory", operations: [], moreOperations: "x" })).toEqual([]);
  });

  it("builds a skill change from tool input", () => {
    expect(skillChangeFromInput("delete", "n", { absorbed_into: "m" })).toEqual(skill({ action: "delete", name: "n", absorbedInto: "m" }));
  });
});
