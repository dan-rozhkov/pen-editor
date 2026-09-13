import { describe, it, expect } from "vitest";
import { findHiddenSelfOrAncestor } from "../nodeUtils";

// A → B → C → D, plus a sibling E with no parent (root), mirroring the flat
// nodesById/parentById shape the real scene store uses.
const nodesById: Record<string, { visible?: boolean; enabled?: boolean }> = {
  a: {},
  b: {},
  c: {},
  d: {},
  e: {},
};
const parentById: Record<string, string | null> = {
  a: null,
  b: "a",
  c: "b",
  d: "c",
  e: null,
};

describe("findHiddenSelfOrAncestor", () => {
  it("returns null when the node and every ancestor are visible and enabled", () => {
    expect(findHiddenSelfOrAncestor(nodesById, parentById, "d")).toBeNull();
  });

  it("treats a node with no explicit visible/enabled field as shown (defaults to true)", () => {
    expect(findHiddenSelfOrAncestor(nodesById, parentById, "e")).toBeNull();
  });

  it("reports the node itself when it is directly hidden (visible: false)", () => {
    const nodes = { ...nodesById, d: { visible: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "d",
      isSelf: true,
      reason: "visible",
    });
  });

  it("reports a hidden immediate parent (visible: false)", () => {
    const nodes = { ...nodesById, c: { visible: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "c",
      isSelf: false,
      reason: "visible",
    });
  });

  it("finds a hidden ancestor several levels up the chain (visible: false)", () => {
    const nodes = { ...nodesById, a: { visible: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "a",
      isSelf: false,
      reason: "visible",
    });
  });

  it("prefers the node itself over a hidden ancestor when both are hidden", () => {
    const nodes = { ...nodesById, a: { visible: false }, d: { visible: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "d",
      isSelf: true,
      reason: "visible",
    });
  });

  it("returns null for a node that isn't in nodesById at all (defensive)", () => {
    expect(findHiddenSelfOrAncestor(nodesById, parentById, "ghost")).toBeNull();
  });

  // enabled === false — how a `ref` instance's overrides hide a
  // component-internal node (see enabled?: boolean in types/scene.ts).
  it("reports the node itself when it is directly disabled (enabled: false)", () => {
    const nodes = { ...nodesById, d: { enabled: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "d",
      isSelf: true,
      reason: "enabled",
    });
  });

  it("reports a disabled ancestor (enabled: false) even when the node itself is visible/enabled", () => {
    const nodes = { ...nodesById, c: { enabled: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "c",
      isSelf: false,
      reason: "enabled",
    });
  });

  it("finds a disabled ancestor several levels up the chain", () => {
    const nodes = { ...nodesById, a: { enabled: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "a",
      isSelf: false,
      reason: "enabled",
    });
  });

  it("reports the nearest hiding ancestor when a farther one is disabled and a closer one is hidden", () => {
    const nodes = { ...nodesById, a: { enabled: false }, c: { visible: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "c",
      isSelf: false,
      reason: "visible",
    });
  });

  it("prefers visible over enabled when a single node has both set to false", () => {
    const nodes = { ...nodesById, d: { visible: false, enabled: false } };
    expect(findHiddenSelfOrAncestor(nodes, parentById, "d")).toEqual({
      nodeId: "d",
      isSelf: true,
      reason: "visible",
    });
  });
});
