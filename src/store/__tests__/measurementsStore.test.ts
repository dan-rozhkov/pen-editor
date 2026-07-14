import { describe, expect, it, beforeEach } from "vitest";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

function pastLen() {
  return useHistoryStore.getState().past.length;
}

describe("measurementsStore", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("starts empty with no selection", () => {
    expect(useMeasurementsStore.getState().measurements).toEqual([]);
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });

  it("addMeasurement adds a persisted measurement and records history", () => {
    const before = pastLen();
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");

    const { measurements } = useMeasurementsStore.getState();
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({ fromId: "rect1", toId: "rect2" });
    expect(measurements[0].id).toBeTruthy();
    expect(pastLen()).toBe(before + 1);
  });

  it("addMeasurement is idempotent for the same (fromId,toId) pair", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    const before = pastLen();
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");

    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);
    expect(pastLen()).toBe(before); // no new history entry for the no-op
  });

  it("addMeasurement treats (b,a) as the same pair as (a,b) — direction doesn't matter", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    useMeasurementsStore.getState().addMeasurement("rect2", "rect1");

    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);
  });

  it("removeMeasurement removes by id and records history", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    const id = useMeasurementsStore.getState().measurements[0].id;
    const before = pastLen();

    useMeasurementsStore.getState().removeMeasurement(id);

    expect(useMeasurementsStore.getState().measurements).toEqual([]);
    expect(pastLen()).toBe(before + 1);
  });

  it("removeMeasurement clears the selection when the removed measurement was selected", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    const id = useMeasurementsStore.getState().measurements[0].id;
    useMeasurementsStore.getState().setSelectedMeasurement(id);

    useMeasurementsStore.getState().removeMeasurement(id);

    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });

  it("setSelectedMeasurement selects/deselects without touching history", () => {
    const before = pastLen();
    useMeasurementsStore.getState().setSelectedMeasurement("m1");
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBe("m1");
    useMeasurementsStore.getState().setSelectedMeasurement(null);
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
    expect(pastLen()).toBe(before);
  });

  it("setMeasurements bulk-replaces without touching history (document load)", () => {
    const before = pastLen();
    useMeasurementsStore.getState().setMeasurements([
      { id: "m1", fromId: "rect1", toId: "rect2" },
    ]);
    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);
    expect(pastLen()).toBe(before);
  });

  it("removeMeasurementsForNodes drops measurements touching any of the given node ids", () => {
    useMeasurementsStore.getState().setMeasurements([
      { id: "m1", fromId: "a", toId: "b" },
      { id: "m2", fromId: "c", toId: "d" },
      { id: "m3", fromId: "e", toId: "a" },
    ]);

    useMeasurementsStore.getState().removeMeasurementsForNodes(["a"]);

    expect(useMeasurementsStore.getState().measurements).toEqual([
      { id: "m2", fromId: "c", toId: "d" },
    ]);
  });

  it("removeMeasurementsForNodes does not touch history", () => {
    useMeasurementsStore.getState().setMeasurements([
      { id: "m1", fromId: "a", toId: "b" },
    ]);
    const before = pastLen();
    useMeasurementsStore.getState().removeMeasurementsForNodes(["a"]);
    expect(pastLen()).toBe(before);
  });

  it("undoing addMeasurement restores the pre-add state via sceneStore snapshot", () => {
    useMeasurementsStore.getState().addMeasurement("rect1", "rect2");
    expect(useMeasurementsStore.getState().measurements).toHaveLength(1);

    const snapshot = useHistoryStore.getState().past.at(-1)!;
    useSceneStore.getState().restoreSnapshot(snapshot);

    expect(useMeasurementsStore.getState().measurements).toEqual([]);
  });
});
