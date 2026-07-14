import { create } from "zustand";
import { useHistoryStore, withHistoryBatch } from "./historyStore";
import { useSceneStore, createSnapshot } from "./sceneStore";

/** A pinned distance measurement between two nodes, persisted per-page (like guides). */
export interface PersistedMeasurement {
  id: string;
  fromId: string;
  toId: string;
}

let nextMeasurementId = 0;
function generateMeasurementId(): string {
  nextMeasurementId += 1;
  return `measurement-${Date.now()}-${nextMeasurementId}`;
}

/** A pair is undirected — (a,b) and (b,a) describe the same distance. */
function isSamePair(m: PersistedMeasurement, fromId: string, toId: string): boolean {
  return (
    (m.fromId === fromId && m.toId === toId) ||
    (m.fromId === toId && m.toId === fromId)
  );
}

interface MeasurementsState {
  /** Persistent pinned measurements for the current page. */
  measurements: PersistedMeasurement[];
  selectedMeasurementId: string | null;
  addMeasurement: (fromId: string, toId: string) => void;
  removeMeasurement: (id: string) => void;
  /** Replace the whole measurements list — used when switching pages / loading a document. */
  setMeasurements: (measurements: PersistedMeasurement[]) => void;
  setSelectedMeasurement: (id: string | null) => void;
  /** Cleanup: drop any measurement touching one of the given node ids (e.g. on node delete). */
  removeMeasurementsForNodes: (nodeIds: string[]) => void;
}

/**
 * Record an undo snapshot before a measurement edit. Mirrors
 * `saveVariableHistory`/`saveTextStyleHistory` — the whole editor state
 * (scene + current measurements) is snapshotted so undo/redo round-trips
 * measurement add/delete the same way it does scene edits.
 */
function saveMeasurementHistory(): void {
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
}

export const useMeasurementsStore = create<MeasurementsState>((set, get) => ({
  measurements: [],
  selectedMeasurementId: null,

  addMeasurement: (fromId, toId) => {
    // Idempotent for the same (fromId,toId) pair — direction doesn't matter for a distance.
    if (get().measurements.some((m) => isSamePair(m, fromId, toId))) return;

    saveMeasurementHistory();
    withHistoryBatch(() => {
      const id = generateMeasurementId();
      set((state) => ({
        measurements: [...state.measurements, { id, fromId, toId }],
      }));
    });
  },

  removeMeasurement: (id) => {
    saveMeasurementHistory();
    withHistoryBatch(() => {
      set((state) => ({
        measurements: state.measurements.filter((m) => m.id !== id),
        selectedMeasurementId:
          state.selectedMeasurementId === id ? null : state.selectedMeasurementId,
      }));
    });
  },

  // Bulk replace (page switch / document load) — not an undoable user edit.
  setMeasurements: (measurements) => set({ measurements }),

  setSelectedMeasurement: (id) => set({ selectedMeasurementId: id }),

  // Cleanup on node delete — the deletion itself already records the undo
  // step (via the scene mutation's own saveHistory), so this is a plain
  // state update with no history save of its own.
  removeMeasurementsForNodes: (nodeIds) => {
    const idSet = new Set(nodeIds);
    set((state) => ({
      measurements: state.measurements.filter(
        (m) => !idSet.has(m.fromId) && !idSet.has(m.toId),
      ),
    }));
  },
}));
