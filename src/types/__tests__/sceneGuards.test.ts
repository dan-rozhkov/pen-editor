import { describe, it, expect } from "vitest";
import {
  isFlatFrameNode,
  isConnectorNode,
  type FlatSceneNode,
  type FlatFrameNode,
  type ConnectorNode,
  type RectNode,
} from "@/types/scene";

const base = { x: 0, y: 0, width: 10, height: 10 };

const frame: FlatFrameNode = { id: "f", type: "frame", ...base };
const connector: ConnectorNode = {
  id: "c",
  type: "connector",
  ...base,
  startConnection: { nodeId: "a", anchor: "top" },
  endConnection: { nodeId: "b", anchor: "bottom" },
  points: [0, 0, 10, 10],
};
const rect: RectNode = { id: "rc", type: "rect", ...base };

describe("isFlatFrameNode", () => {
  it("returns true for a frame node", () => {
    expect(isFlatFrameNode(frame)).toBe(true);
  });
  it("returns false for a connector node", () => {
    expect(isFlatFrameNode(connector)).toBe(false);
  });
  it("returns false for a node of a different shape (rect)", () => {
    expect(isFlatFrameNode(rect as FlatSceneNode)).toBe(false);
  });
});

describe("isConnectorNode", () => {
  it("returns true for a connector node", () => {
    expect(isConnectorNode(connector)).toBe(true);
  });
  it("returns false for a frame node", () => {
    expect(isConnectorNode(frame)).toBe(false);
  });
  it("returns false for a node of a different shape (rect)", () => {
    expect(isConnectorNode(rect as FlatSceneNode)).toBe(false);
  });
});
