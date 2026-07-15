import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { EllipseNode, PathNode, RectNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

/** Add two overlapping shapes as siblings under frame1 for boolean-op tests. */
function seedOverlappingShapes(): void {
  const square: RectNode = {
    id: "square",
    type: "rect",
    name: "Square",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fill: "#ff0000",
  };
  const circle: EllipseNode = {
    id: "circle",
    type: "ellipse",
    name: "Circle",
    x: 35,
    y: 35,
    width: 30,
    height: 30,
    fill: "#00ff00",
  };
  scene().addChildToFrame("frame1", square);
  scene().addChildToFrame("frame1", circle);
}

describe("booleanOperation", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedOverlappingShapes();
  });

  it("replaces the selected shapes with a single evenodd path node (subtract)", () => {
    const before = pastLen();
    const resultId = scene().booleanOperation(["square", "circle"], "subtract");
    expect(resultId).toBeTruthy();

    const s = scene();
    const path = s.nodesById[resultId!] as PathNode;
    expect(path.type).toBe("path");
    expect(path.fillRule).toBe("evenodd");
    // Square minus a fully-contained circle keeps the square's fill (bottom-most shape).
    expect(path.fill).toBe("#ff0000");
    // Two subpaths: the square's outline + the circular hole.
    expect(path.geometry.match(/M/g)?.length).toBe(2);

    // Originals are gone, reparented correctly under frame1.
    expect(s.nodesById["square"]).toBeUndefined();
    expect(s.nodesById["circle"]).toBeUndefined();
    expect(s.parentById[resultId!]).toBe("frame1");
    expect(s.childrenById["frame1"]).toContain(resultId);
    expect(s.childrenById["frame1"]).not.toContain("square");
    expect(s.childrenById["frame1"]).not.toContain("circle");

    expect(pastLen()).toBe(before + 1);
  });

  it("drops a pinned measurement anchored to one of the merged shapes", () => {
    useMeasurementsStore.getState().addMeasurement("square", "rect1");
    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);

    const resultId = scene().booleanOperation(["square", "circle"], "union");
    expect(resultId).toBeTruthy();
    expect(useMeasurementsStore.getState().measurements).toHaveLength(0);
  });

  it("undo restores the original square and circle nodes", () => {
    const resultId = scene().booleanOperation(["square", "circle"], "union");
    expect(resultId).toBeTruthy();

    const snapshot = useHistoryStore.getState().past.at(-1)!;
    scene().restoreSnapshot(snapshot);

    const s = scene();
    expect(s.nodesById["square"]).toBeDefined();
    expect(s.nodesById["circle"]).toBeDefined();
    expect(s.nodesById[resultId!]).toBeUndefined();
    expect(s.childrenById["frame1"]).toContain("square");
    expect(s.childrenById["frame1"]).toContain("circle");
  });

  it("union produces a bbox spanning both shapes", () => {
    const resultId = scene().booleanOperation(["square", "circle"], "union");
    const path = scene().nodesById[resultId!] as PathNode;
    // circle is fully inside the square, so the union bbox equals the square's.
    expect(path.x).toBeCloseTo(0);
    expect(path.y).toBeCloseTo(0);
    expect(path.width).toBeCloseTo(100, 0);
    expect(path.height).toBeCloseTo(100, 0);
  });

  it("intersect of a fully-contained circle equals the circle's bbox", () => {
    const resultId = scene().booleanOperation(["square", "circle"], "intersect");
    const path = scene().nodesById[resultId!] as PathNode;
    expect(path.x).toBeCloseTo(35, 0);
    expect(path.y).toBeCloseTo(35, 0);
    expect(path.width).toBeCloseTo(30, 0);
    expect(path.height).toBeCloseTo(30, 0);
  });

  it("flatten behaves like union", () => {
    const unionId = scene().booleanOperation(["square", "circle"], "union");
    const unionPath = scene().nodesById[unionId!] as PathNode;

    resetStores();
    seedScene();
    seedOverlappingShapes();
    const flattenId = scene().booleanOperation(["square", "circle"], "flatten");
    const flattenPath = scene().nodesById[flattenId!] as PathNode;

    expect(flattenPath.width).toBeCloseTo(unionPath.width);
    expect(flattenPath.height).toBeCloseTo(unionPath.height);
  });

  it("returns null and skips history when nodes don't share a parent", () => {
    const before = pastLen();
    expect(scene().booleanOperation(["square", "rect2"], "union")).toBeNull();
    expect(pastLen()).toBe(before);
  });

  it("returns null for unsupported node types (e.g. text)", () => {
    expect(scene().booleanOperation(["square", "text1"], "union")).toBeNull();
  });

  it("returns null when subtracting a shape that fully covers the base", () => {
    const cover: RectNode = {
      id: "cover",
      type: "rect",
      x: -50,
      y: -50,
      width: 200,
      height: 200,
    };
    scene().addChildToFrame("frame1", cover);
    expect(scene().booleanOperation(["square", "cover"], "subtract")).toBeNull();
  });
});
