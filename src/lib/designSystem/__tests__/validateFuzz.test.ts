import { describe, expect, it } from "vitest";
import { validateSnapshot } from "@/lib/designSystem";
import { snap } from "./snapshotFixtures";

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const base = () => JSON.parse(JSON.stringify(snap())) as Rec;

const mutations: [string, (s: Rec) => void][] = [
  ["collection is null", (s) => (s.collections[0] = null)],
  ["collection modes is not an array", (s) => (s.collections[0].modes = "light")],
  ["collection modes is null", (s) => (s.collections[0].modes = null)],
  ["a mode is null", (s) => (s.collections[0].modes[0] = null)],
  ["defaultModeId is a number", (s) => (s.collections[0].defaultModeId = 3)],
  ["variable is a string", (s) => (s.variables[0] = "x")],
  ["valuesByMode is null", (s) => (s.variables[0].valuesByMode = null)],
  ["valuesByMode is an array", (s) => (s.variables[0].valuesByMode = [])],
  ["a value is null", (s) => (s.variables[0].valuesByMode.light = null)],
  ["a value is a number", (s) => (s.variables[0].valuesByMode.light = 5)],
  ["an alias is not a string", (s) => (s.variables[0].valuesByMode.light = { alias: 1 })],
  ["deprecated is a string", (s) => (s.variables[0].deprecated = "yes")],
  ["component is null", (s) => (s.components[0] = null)],
  ["component meta is missing", (s) => delete s.components[0].meta],
  ["component meta is a string", (s) => (s.components[0].meta = "m")],
  ["component meta.deprecated is null-ish object", (s) => (s.components[0].meta.deprecated = 7)],
  ["collection name is a number", (s) => (s.collections[0].name = 1)],
  ["collection name is missing", (s) => delete s.collections[0].name],
  ["a mode id is a number", (s) => (s.collections[0].modes[0].id = 1)],
  ["a mode name is a number", (s) => (s.collections[0].modes[0].name = 1)],
  ["a mode name is missing", (s) => delete s.collections[0].modes[0].name],
  ["variable name is a number", (s) => (s.variables[0].name = 1)],
  ["variable name is missing", (s) => delete s.variables[0].name],
  ["component key is a number", (s) => (s.components[0].key = 1)],
  ["component name is a number", (s) => (s.components[0].meta.name = 1)],
  ["component name is missing", (s) => delete s.components[0].meta.name],
  ["docs is a string", (s) => (s.docs = "readme")],
  ["docs.readme is a number", (s) => (s.docs = { readme: 1 })],
];

describe("validateSnapshot: malformed nested shapes", () => {
  it("accepts the well-formed fixture", () => {
    expect(validateSnapshot(base()).ok).toBe(true);
  });

  it.each(mutations)("returns invalid_snapshot, never throws: %s", (_name, mutate) => {
    const s = base();
    mutate(s);
    expect(validateSnapshot(s)).toMatchObject({ ok: false, code: "invalid_snapshot" });
  });

  it.each([null, undefined, 3, "x", [], {}, { schemaVersion: 1 }, { schemaVersion: 1, collections: [null], variables: [null], components: [null] }])(
    "rejects top-level junk %#",
    (junk) => {
      expect(validateSnapshot(junk).ok).toBe(false);
    },
  );
});
