import { describe, expect, it } from "vitest";
import { buildVariableIndex } from "../variableIndex";
import { aliasDependents, findCycles, wouldCreateCycle } from "../aliasGraph";
import { collections, v2Var } from "./fixtures";

const lit = (id: string) => v2Var(id, "theme", { light: "#fff", dark: "#000" });
const al = (id: string, target: string) => v2Var(id, "theme", { light: { alias: target }, dark: "#000" });

describe("wouldCreateCycle", () => {
  it("flags a self-loop", () => {
    const idx = buildVariableIndex([lit("a")], collections);
    expect(wouldCreateCycle(idx, "a", "a")).toBe(true);
  });

  it("flags a 2-cycle and a 3-cycle", () => {
    const two = buildVariableIndex([lit("a"), al("b", "a")], collections);
    expect(wouldCreateCycle(two, "a", "b")).toBe(true);
    const three = buildVariableIndex([lit("a"), al("b", "a"), al("c", "b")], collections);
    expect(wouldCreateCycle(three, "a", "c")).toBe(true);
  });

  it("allows a diamond", () => {
    const idx = buildVariableIndex([lit("base"), al("l", "base"), al("r", "base"), lit("top")], collections);
    expect(wouldCreateCycle(idx, "top", "l")).toBe(false);
    expect(wouldCreateCycle(idx, "r", "l")).toBe(false);
  });
});

describe("findCycles", () => {
  it("returns nothing for a diamond", () => {
    expect(findCycles([lit("base"), al("l", "base"), al("r", "base"), al("top", "l")])).toEqual([]);
  });

  it("finds a self-loop and a 3-cycle", () => {
    const cycles = findCycles([al("s", "s"), al("a", "b"), al("b", "c"), al("c", "a"), lit("z")]);
    const sorted = cycles.map((c) => [...c].sort()).sort((x, y) => x[0].localeCompare(y[0]));
    expect(sorted).toEqual([["a", "b", "c"], ["s"]]);
  });
});

describe("aliasDependents", () => {
  it("returns the transitive set of variables that point at an id", () => {
    const idx = buildVariableIndex([lit("base"), al("l", "base"), al("top", "l"), lit("other")], collections);
    expect([...aliasDependents(idx, "base")].sort()).toEqual(["l", "top"]);
  });
});
