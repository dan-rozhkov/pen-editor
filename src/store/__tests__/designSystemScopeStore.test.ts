import { describe, it, expect, beforeEach } from "vitest";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { resetStores } from "@/test/fixtures";

const store = () => useDesignSystemScopeStore.getState();

describe("designSystemScopeStore", () => {
  beforeEach(() => resetStores());

  it("adds a scope with a fresh id", () => {
    const a = store().addScope({ name: "Brand", collections: ["brand"] });
    const b = store().addScope({ name: "Brand", collections: ["brand"] });
    expect(a.id).not.toBe(b.id);
    expect(store().scopes.map((s) => s.name)).toEqual(["Brand", "Brand"]);
    expect(store().scopes[0]).toMatchObject({ id: a.id, collections: ["brand"] });
  });

  it("renames and updates a scope in place", () => {
    const a = store().addScope({ name: "A" });
    store().updateScope(a.id, { name: "A2", names: ["--x*"] });
    expect(store().scopes[0]).toEqual({ id: a.id, name: "A2", names: ["--x*"] });
  });

  it("ignores an update for an unknown id and never changes the id", () => {
    const a = store().addScope({ name: "A" });
    const before = store().scopes;
    store().updateScope("nope", { name: "X" });
    expect(store().scopes).toBe(before);
    store().updateScope(a.id, { name: "B", ...({ id: "other" } as object) });
    expect(store().scopes[0].id).toBe(a.id);
  });

  it("deletes a scope", () => {
    const a = store().addScope({ name: "A" });
    const b = store().addScope({ name: "B" });
    store().deleteScope(a.id);
    expect(store().scopes.map((s) => s.id)).toEqual([b.id]);
  });

  it("replaces all scopes and drops malformed ones", () => {
    store().addScope({ name: "Old" });
    store().setScopes([{ id: "s1", name: "New" }, { id: "", name: "bad" }] as never);
    expect(store().scopes).toEqual([{ id: "s1", name: "New" }]);
  });

  it("is reset by resetStores", () => {
    store().addScope({ name: "A" });
    resetStores();
    expect(store().scopes).toEqual([]);
  });
});
