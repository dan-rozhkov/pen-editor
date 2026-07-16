import { describe, it, expect } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useDevExportStore } from "@/store/devExportStore";

describe("resetStores", () => {
  it("clears useDevExportStore overrides (finding 4 — no leakage between tests)", () => {
    useDevExportStore.setState({ overrides: { n1: [{ id: "a", format: "png", scale: 1 }] } });

    resetStores();

    expect(useDevExportStore.getState().overrides).toEqual({});
  });
});
