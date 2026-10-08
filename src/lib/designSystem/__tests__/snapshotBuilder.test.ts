import { beforeEach, describe, expect, it } from "vitest";
import type { Variable } from "@/types/variable";
import { useVariableStore } from "@/store/variableStore";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { defineComponent } from "@/lib/tools/components";
import { BTN_HTML, CARD_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { parse, resetWorld, seedEmbed } from "@/test/componentFixtures";
import { computeRev } from "@/lib/embedComponents";
import {
  applyDeprecationSince,
  buildSnapshot,
  deprecateComponent,
  deprecateVariable,
  diffSnapshots,
  undeprecateComponent,
  undeprecateVariable,
  validateSnapshot,
} from "@/lib/designSystem";

const theme = (id: string, name: string, light: string, dark = light, extra: Partial<Variable> = {}): Variable => ({
  id,
  name,
  type: "color",
  collectionId: "theme",
  valuesByMode: { light, dark },
  value: light,
  ...extra,
});

const store = () => useVariableStore.getState();
const byId = (id: string) => store().variables.find((v) => v.id === id);

async function defineBtn(): Promise<void> {
  const result = parse(await defineComponent({ key: "btn", name: "Button", html: BTN_HTML, variants: { kind: ["primary", "secondary"] } }));
  expect(result.error).toBeUndefined();
}

beforeEach(() => {
  resetWorld();
  store().replaceAll([theme("var_brand", "Brand", "#0055ff", "#4488ff"), theme("var_bg", "Background", "#ffffff", "#111111")]);
});

describe("buildSnapshot", () => {
  it("builds a valid v1 snapshot without the compat mirrors", async () => {
    await defineBtn();
    const { snapshot, issues } = buildSnapshot({ readme: "# Kit" });
    expect(issues).toEqual([]);
    expect(validateSnapshot(snapshot).ok).toBe(true);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.docs).toEqual({ readme: "# Kit" });
    expect(snapshot.variables[0]).toEqual({
      id: "var_brand",
      name: "Brand",
      type: "color",
      collectionId: "theme",
      valuesByMode: { light: "#0055ff", dark: "#4488ff" },
    });
    expect(snapshot.collections.map((c) => c.id)).toEqual(["theme"]);
    const master = selectComponentRegistry().get("btn");
    expect(snapshot.components).toEqual([
      {
        key: "btn",
        html: master?.html,
        rev: master ? computeRev(master) : "",
        meta: { name: "Button", variants: { kind: ["primary", "secondary"] } },
      },
    ]);
  });

  it("omits docs without a readme and is deterministic", () => {
    const a = buildSnapshot().snapshot;
    expect(a.docs).toBeUndefined();
    expect(buildSnapshot().snapshot).toEqual(a);
    expect(diffSnapshots(a, buildSnapshot().snapshot).requiredBump).toBe("none");
  });

  it("excludes library-owned variables, collections and masters", async () => {
    await defineBtn();
    seedEmbed("libmaster", CARD_HTML, { component: { key: "card", name: "Card", library: { id: "lib_x", version: "1.0.0" } } });
    store().replaceAll(
      [...store().variables, theme("var_lib", "Lib token", "#000", "#000", { libraryId: "lib_x", type: "number" }), { id: "var_lib_space", name: "Lib space", type: "number", collectionId: "col_x", valuesByMode: { a: "1" }, value: "1", libraryId: "lib_x" }],
      [...store().collections, { id: "col_x", name: "X", modes: [{ id: "a", name: "A" }], defaultModeId: "a", libraryId: "lib_x" }],
    );
    const { snapshot, issues } = buildSnapshot();
    expect(issues).toEqual([]);
    expect(snapshot.variables.map((v) => v.id)).toEqual(["var_brand", "var_bg"]);
    expect(snapshot.collections.map((c) => c.id)).toEqual(["theme"]);
    expect(snapshot.components.map((c) => c.key)).toEqual(["btn"]);
  });

  it("still reports an alias into a library token that cannot be inlined (type mismatch)", () => {
    store().replaceAll(
      [theme("var_lib", "Lib token", "#000", "#000", { libraryId: "lib_x", type: "number" }), theme("var_mine", "Mine", "#111", "#111", { valuesByMode: { light: { alias: "var_lib" }, dark: "#111" } })],
    );
    const { issues } = buildSnapshot();
    expect(issues.map((i) => i.message).join(" ")).toContain('alias target "var_lib" does not exist');
  });

  it("reports a Theme collection that lost its modes", () => {
    const issues = buildSnapshot().issues;
    expect(issues).toEqual([]);
    store().replaceAll(store().variables, [{ ...store().collections[0], modes: [{ id: "light", name: "Light" }] }]);
    // The store re-adds a valid Theme only if absent; a damaged one is passed through to the builder's check.
    expect(buildSnapshot().issues.some((i) => i.message.includes("theme"))).toBe(true);
  });

  it("carries variable docs, scopes and deprecation; a new deprecation is a minor bump", () => {
    const before = buildSnapshot().snapshot;
    expect(deprecateVariable("var_bg", { replacedBy: "var_brand", note: "use brand" })).toEqual({ ok: true });
    store().updateVariable("var_brand", { description: "Primary", scopes: ["fill"] });
    const after = buildSnapshot().snapshot;
    expect(after.variables[0]).toMatchObject({ description: "Primary", scopes: ["fill"] });
    expect(after.variables[1].deprecated).toEqual({ replacedBy: "var_brand", note: "use brand" });
    expect(diffSnapshots(before, after).requiredBump).toBe("minor");
  });
});

describe("deprecation authoring", () => {
  it("validates the replacement like the server does", () => {
    store().replaceAll([...store().variables, { id: "var_num", name: "Num", type: "number", collectionId: "theme", valuesByMode: { light: "1", dark: "1" }, value: "1" }]);
    expect(deprecateVariable("ghost")).toMatchObject({ error: expect.stringContaining("not found") });
    expect(deprecateVariable("var_bg", { replacedBy: "ghost" })).toMatchObject({ error: expect.stringContaining("Replacement not found") });
    expect(deprecateVariable("var_bg", { replacedBy: "var_bg" })).toMatchObject({ error: expect.stringContaining("itself") });
    expect(deprecateVariable("var_bg", { replacedBy: "var_num" })).toMatchObject({ error: expect.stringContaining("type") });
    expect(byId("var_bg")?.deprecated).toBeUndefined();
  });

  it("warns when there is neither a replacement nor a note, and can be undone", () => {
    const result = deprecateVariable("var_bg");
    expect(result).toMatchObject({ ok: true, warning: expect.stringContaining("cannot be removed") });
    expect(byId("var_bg")?.deprecated).toEqual({});
    expect(undeprecateVariable("var_bg")).toEqual({ ok: true });
    expect(byId("var_bg")?.deprecated).toBeUndefined();
  });

  it("refuses library-owned tokens and library replacements", () => {
    store().replaceAll([...store().variables, theme("var_lib", "Lib", "#000", "#000", { libraryId: "lib_x" })]);
    expect(deprecateVariable("var_lib", { note: "x" })).toMatchObject({ error: expect.stringContaining("library-owned, read-only") });
    expect(deprecateVariable("var_bg", { replacedBy: "var_lib" })).toMatchObject({ error: expect.stringContaining("another library") });
  });

  it("deprecates and un-deprecates a component, keeping its HTML", async () => {
    await defineBtn();
    const htmlBefore = selectComponentRegistry().get("btn")?.html;
    expect(deprecateComponent("btn", { note: "use link" })).toEqual({ ok: true });
    expect(selectComponentRegistry().get("btn")?.meta.deprecated).toEqual({ note: "use link" });
    expect(selectComponentRegistry().get("btn")?.html).toBe(htmlBefore);
    expect(deprecateComponent("btn", { replacedBy: "nope" })).toMatchObject({ error: expect.stringContaining("Replacement not found") });
    expect(undeprecateComponent("btn")).toEqual({ ok: true });
    expect(selectComponentRegistry().get("btn")?.meta.deprecated).toBeUndefined();
    expect(deprecateComponent("ghost")).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("refuses a library component", () => {
    seedEmbed("libmaster", BTN_HTML, { component: { key: "btn", name: "Button", library: { id: "lib_x", version: "1.0.0" } } });
    expect(deprecateComponent("btn", { note: "x" })).toMatchObject({ error: expect.stringContaining("Library component") });
  });

  it("applyDeprecationSince writes the published version back so the next diff is clean", async () => {
    await defineBtn();
    deprecateVariable("var_bg", { note: "old" });
    deprecateComponent("btn", { note: "old" });
    expect(applyDeprecationSince("1.1.0")).toBe(2);
    expect(byId("var_bg")?.deprecated).toEqual({ since: "1.1.0", note: "old" });
    expect(selectComponentRegistry().get("btn")?.meta.deprecated).toEqual({ since: "1.1.0", note: "old" });
    expect(applyDeprecationSince("1.2.0")).toBe(0);
  });
});

describe("buildSnapshot: a library built on a base library", () => {
  it("inlines aliases to library-owned tokens and publishes cleanly", () => {
    store().replaceAll(
      [
        theme("base_brand", "Base Brand", "#0055ff", "#4488ff", { libraryId: "lib_base" }),
        theme("var_cta", "CTA", "#000000", "#000000", { valuesByMode: { light: { alias: "base_brand" }, dark: { alias: "base_brand" } } }),
        theme("var_chain", "Chain", "#000000", "#000000", { valuesByMode: { light: { alias: "var_cta" }, dark: { alias: "var_cta" } } }),
      ],
      store().collections,
    );
    const { snapshot, issues, notes } = buildSnapshot();
    expect(issues).toEqual([]);
    expect(validateSnapshot(snapshot).ok).toBe(true);
    expect(snapshot.variables.map((v) => v.id)).toEqual(["var_cta", "var_chain"]);
    expect(snapshot.variables[0].valuesByMode).toEqual({ light: "#0055ff", dark: "#4488ff" });
    expect(snapshot.variables[1].valuesByMode).toEqual({ light: { alias: "var_cta" }, dark: { alias: "var_cta" } });
    expect(notes.map((n) => n.message)).toEqual(["alias to library token Base Brand inlined", "alias to library token Base Brand inlined"]);
  });
});
