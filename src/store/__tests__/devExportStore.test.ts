import { beforeEach, describe, expect, it } from "vitest";
import { useDevExportStore } from "@/store/devExportStore";

describe("devExportStore", () => {
  beforeEach(() => {
    useDevExportStore.setState({ overrides: {} });
  });

  it("starts with no overrides", () => {
    expect(useDevExportStore.getState().overrides).toEqual({});
  });

  it("setOverride stores a per-node export settings override", () => {
    useDevExportStore.getState().setOverride("n1", [{ id: "a", format: "png", scale: 2 }]);
    expect(useDevExportStore.getState().overrides.n1).toEqual([{ id: "a", format: "png", scale: 2 }]);
  });

  it("setOverride for one node does not affect another node's override", () => {
    useDevExportStore.getState().setOverride("n1", [{ id: "a", format: "png", scale: 1 }]);
    useDevExportStore.getState().setOverride("n2", [{ id: "b", format: "svg", scale: 1 }]);
    expect(useDevExportStore.getState().overrides.n1).toEqual([{ id: "a", format: "png", scale: 1 }]);
    expect(useDevExportStore.getState().overrides.n2).toEqual([{ id: "b", format: "svg", scale: 1 }]);
  });

  it("clearAll wipes every override", () => {
    useDevExportStore.getState().setOverride("n1", [{ id: "a", format: "png", scale: 1 }]);
    useDevExportStore.getState().clearAll();
    expect(useDevExportStore.getState().overrides).toEqual({});
  });
});
