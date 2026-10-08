import { describe, expect, it } from "vitest";
import {
  MAX_CHANGED_ENTRIES,
  buildChangelog,
  checkSnapshotIntegrity,
  diffSnapshots,
  isBumpAllowed,
  nextVersions,
  parseVersion,
  planRelease,
  renderChangelogMarkdown,
  stampDeprecationSince,
  suggestBump,
  validateSnapshot,
} from "@/lib/designSystem";
import { assertDefined } from "@/test/assertions";
import { THEME, colorVar, snap } from "./snapshotFixtures";

describe("semver", () => {
  it("parses plain versions only", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("01.2.3")).toBeNull();
    expect(parseVersion("1.2.3-beta")).toBeNull();
  });

  it("derives the next versions; the first publish is 1.0.0", () => {
    expect(nextVersions("1.4.2")).toEqual({ major: "2.0.0", minor: "1.5.0", patch: "1.4.3" });
    expect(nextVersions(null)).toEqual({ major: "1.0.0", minor: "1.0.0", patch: "1.0.0" });
  });
});

describe("bump rules", () => {
  it("lets the owner raise the bump, never lower it", () => {
    expect(isBumpAllowed("major", "minor")).toBe(true);
    expect(isBumpAllowed("minor", "minor")).toBe(true);
    expect(isBumpAllowed("patch", "minor")).toBe(false);
    expect(isBumpAllowed("patch", "none")).toBe(true);
    expect(suggestBump("initial")).toBeNull();
    expect(suggestBump("major")).toBe("major");
  });

  it("treats a CSS name change as major and a same-CSS rename as patch", () => {
    const before = snap();
    const renamed = snap({ variables: [colorVar("var_brand", "Brand 2", "#0055ff", "#4488ff"), before.variables[1]] });
    const recased = snap({ variables: [colorVar("var_brand", "BRAND", "#0055ff", "#4488ff"), before.variables[1]] });
    expect(diffSnapshots(before, renamed).requiredBump).toBe("major");
    expect(diffSnapshots(before, recased).requiredBump).toBe("patch");
    expect(planRelease(before, renamed, "1.0.0").migrations).toEqual([
      { op: "renameToken", id: "var_brand", cssFrom: "--brand", cssTo: "--brand-2" },
    ]);
  });
});

describe("planRelease", () => {
  it("is not publishable without changes or while the removal policy fails", () => {
    const before = snap();
    expect(planRelease(before, snap(), "1.0.0")).toMatchObject({ noChanges: true, publishable: false, requiredBump: "none" });
    const removed = snap({ variables: [before.variables[1]] });
    const plan = planRelease(before, removed, "1.0.0");
    expect(plan.violations.map((v) => v.code)).toEqual(["removal_not_deprecated"]);
    expect(plan.migrations).toEqual([]);
    expect(plan.publishable).toBe(false);
  });

  it("first publish: initial bump, version 1.0.0, publishable", () => {
    const plan = planRelease(null, snap(), null);
    expect(plan.requiredBump).toBe("initial");
    expect(plan.versions.patch).toBe("1.0.0");
    expect(plan.publishable).toBe(true);
  });
});

describe("snapshot validation", () => {
  it("refuses a schemaVersion above the supported one", () => {
    const result = validateSnapshot({ ...snap(), schemaVersion: 2 });
    expect(result).toMatchObject({ ok: false, code: "unsupported_schema" });
  });

  it("catches the integrity rules the server enforces", () => {
    const brand = colorVar("var_brand", "Brand", "#fff");
    const cases: Array<[string, ReturnType<typeof snap>]> = [
      ["Theme modes", snap({ collections: [{ ...snap().collections[0], modes: [{ id: "light", name: "L" }], defaultModeId: "light" }] })],
      [
        "alias cycle",
        snap({
          variables: [
            { ...colorVar("a", "A", "#000"), valuesByMode: { light: { alias: "b" }, dark: "#000" } },
            { ...colorVar("b", "B", "#000"), valuesByMode: { light: { alias: "a" }, dark: "#000" } },
          ],
        }),
      ],
      ["missing alias", snap({ variables: [{ ...brand, valuesByMode: { light: { alias: "nope" }, dark: "#000" } }] })],
      ["unknown mode", snap({ variables: [{ ...brand, valuesByMode: { light: "#fff", night: "#000" } }] })],
      ["replacedBy missing", snap({ variables: [{ ...brand, deprecated: { replacedBy: "ghost" } }] })],
      ["component key", snap({ components: [{ ...snap().components[0], key: "slot" }] })],
      ["duplicate id", snap({ variables: [brand, brand] })],
      ["NUL", snap({ variables: [{ ...brand, description: "a\u0000b" }] })],
    ];
    for (const [label, bad] of cases) {
      expect(validateSnapshot(bad).ok, label).toBe(false);
    }
    expect(checkSnapshotIntegrity(snap())).toEqual([]);
  });
});

describe("changelog", () => {
  it("resolves old and new values per mode, through aliases", () => {
    const before = snap({
      variables: [
        colorVar("var_brand", "Brand", "#0055ff", "#4488ff"),
        colorVar("var_accent", "Accent", "#000000"),
      ],
    });
    const after = snap({
      variables: [
        colorVar("var_brand", "Brand", "#0055ff", "#4488ff"),
        { ...colorVar("var_accent", "Accent", "#000000"), valuesByMode: { light: { alias: "var_brand" }, dark: "#000000" } },
      ],
    });
    const diff = diffSnapshots(before, after);
    const changelog = buildChangelog(before, after, diff, { from: "1.0.0", to: "1.0.1" });
    const entry = changelog.entries.find((e) => e.entity === "variable:var_accent");
    assertDefined(entry);
    expect(entry.values).toEqual([
      { modeId: "light", modeName: "Light", from: "#000000", to: "#0055ff", toAlias: "Brand" },
    ]);
    expect(changelog.bump).toBe("patch");
  });

  it("falls back to the previous snapshot's mode name when the new one lost the mode", () => {
    const mk = (modes: { id: string; name: string }[]) => ({ id: "col", name: "Density", modes, defaultModeId: modes[0].id });
    const v = (value: string) => ({ id: "sp", name: "Space", type: "number" as const, collectionId: "col", valuesByMode: { compact: value } });
    const before = snap({ collections: [THEME, mk([{ id: "compact", name: "Compact" }])], variables: [v("4")] });
    const after = snap({ collections: [THEME, mk([{ id: "roomy", name: "Roomy" }])], variables: [v("8")] });
    const changelog = buildChangelog(before, after, diffSnapshots(before, after), { from: "1.0.0", to: "1.0.1" });
    const entry = changelog.entries.find((e) => e.entity === "variable:sp");
    assertDefined(entry);
    expect(entry.values?.[0].modeName).toBe("Compact");
  });

  it("groups reasons per entity and orders removed, added, deprecated, changed", () => {
    const before = snap({ variables: [colorVar("a", "A", "#111"), colorVar("b", "B", "#222", "#222", { deprecated: { note: "old" } }), colorVar("c", "C", "#333")] });
    const after = snap({
      variables: [colorVar("a", "A", "#999", "#999", { deprecated: { note: "x" } }), colorVar("c", "C", "#333"), colorVar("d", "D", "#444")],
    });
    const changelog = buildChangelog(before, after, diffSnapshots(before, after), { from: "1.0.0", to: "2.0.0" });
    expect(changelog.entries.map((e) => [e.kind, e.entity])).toEqual([
      ["removed", "variable:b"],
      ["added", "variable:d"],
      ["deprecated", "variable:a"],
    ]);
    expect(changelog.entries[2].reasons).toEqual(["variable deprecated", "value changed"]);
  });

  it("caps changed entries and counts the rest", () => {
    const many = Array.from({ length: MAX_CHANGED_ENTRIES + 7 }, (_, i) => colorVar(`v${i}`, `V${i}`, "#000"));
    const before = snap({ variables: many });
    const after = snap({ variables: many.map((v) => ({ ...v, valuesByMode: { light: "#fff", dark: "#fff" } })) });
    const changelog = buildChangelog(before, after, diffSnapshots(before, after), { from: "1.0.0", to: "1.0.1" });
    expect(changelog.entries).toHaveLength(MAX_CHANGED_ENTRIES);
    expect(changelog.omitted).toBe(7);
  });

  it("renders markdown with a Breaking section first", () => {
    const before = snap();
    const after = snap({ variables: [before.variables[1]] });
    const changelog = buildChangelog(before, after, diffSnapshots(before, after), { from: "1.0.0", to: "2.0.0" });
    const md = renderChangelogMarkdown(changelog);
    expect(md.startsWith("## 2.0.0\n")).toBe(true);
    expect(md).toContain("### Breaking");
    expect(md).toContain("Brand [variable:var_brand]: variable removed");
  });
});

describe("stampDeprecationSince", () => {
  it("fills since where missing and keeps an existing one", () => {
    const s = snap({
      variables: [
        colorVar("a", "A", "#1", "#1", { deprecated: { note: "n" } }),
        colorVar("b", "B", "#2", "#2", { deprecated: { since: "1.0.0", note: "n" } }),
        colorVar("c", "C", "#3"),
      ],
    });
    const out = stampDeprecationSince(s, "1.1.0");
    expect(out.variables.map((v) => v.deprecated?.since)).toEqual(["1.1.0", "1.0.0", undefined]);
    expect(s.variables[0].deprecated?.since).toBeUndefined();
  });

  it("overrides an explicit empty or undefined since", () => {
    const s = snap({
      variables: [
        colorVar("a", "A", "#1", "#1", { deprecated: { since: undefined, note: "n" } }),
        colorVar("b", "B", "#2", "#2", { deprecated: { since: "", note: "n" } }),
      ],
    });
    const out = stampDeprecationSince(s, "2.0.0");
    expect(out.variables.map((v) => v.deprecated?.since)).toEqual(["2.0.0", "2.0.0"]);
  });
});
