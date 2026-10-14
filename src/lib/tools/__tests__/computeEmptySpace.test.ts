import { beforeEach, describe, expect, it } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { computeEmptySpace } from "../findEmptySpace";

describe("computeEmptySpace", () => {
  beforeEach(() => {
    resetStores();
  });

  it("returns the origin on an empty canvas", () => {
    expect(computeEmptySpace(useSceneStore.getState(), { width: 10, height: 10 })).toEqual({ x: 0, y: 0 });
  });

  it("places right of root content by default, centered vertically", () => {
    seedScene();
    // roots span x 100..800, y 100..400
    expect(computeEmptySpace(useSceneStore.getState(), { width: 200, height: 100 })).toEqual({ x: 850, y: 200 });
  });

  it("honors direction and padding", () => {
    seedScene();
    const s = useSceneStore.getState();
    expect(computeEmptySpace(s, { width: 200, height: 100, direction: "bottom", padding: 10 })).toEqual({ x: 350, y: 410 });
    expect(computeEmptySpace(s, { width: 200, height: 100, direction: "left" })).toEqual({ x: -150, y: 200 });
  });

  it("reports a missing anchor node", () => {
    expect(computeEmptySpace(useSceneStore.getState(), { width: 1, height: 1, nodeId: "nope" })).toEqual({
      error: 'Node "nope" not found',
    });
  });
});
