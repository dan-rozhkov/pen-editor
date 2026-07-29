import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess }),
}));

import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { useViewportStore } from "@/store/viewportStore";
import { storeShowcaseScreensHandoff } from "@/lib/showcaseScreenHandoff";
import { importShowcaseScreensFromHandoff } from "@/lib/importShowcaseScreens";
import type { EmbedNode } from "@/types/scene";

// Replicates the real undo/redo cycle (see
// src/store/sceneStore/__tests__/mutations.test.ts): snapshot current, ask
// history for the target, restore it if present.
function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
}

const HANDOFF_SCREENS = [
  { id: "screen-a", title: "Home" },
  { id: "screen-b", title: "Detail" },
];

function stubFetchWithScreens(screens: Array<{ id: string; title: string; width: number; height: number; htmlContent: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ screens }),
    }),
  );
}

beforeEach(() => {
  resetStores();
  sessionStorage.clear();
  toastError.mockClear();
  toastSuccess.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importShowcaseScreensFromHandoff", () => {
  it("does nothing and returns false when there is no handoff", async () => {
    expect(await importShowcaseScreensFromHandoff()).toBe(false);
    expect(useSceneStore.getState().rootIds).toEqual([]);
  });

  it("creates one embed node per screen, laid out in a row in carousel order", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
      { id: "screen-b", title: "Detail", width: 390, height: 844, htmlContent: "<div>Detail</div>" },
    ]);

    expect(await importShowcaseScreensFromHandoff()).toBe(true);

    const { nodesById, rootIds } = useSceneStore.getState();
    expect(rootIds).toHaveLength(2);
    const created = rootIds.map((id) => nodesById[id] as EmbedNode);
    expect(created.map((n) => n.htmlContent)).toEqual(["<div>Home</div>", "<div>Detail</div>"]);
    expect(created[0].type).toBe("embed");
    expect(created[0].x).toBe(0);
    expect(created[1].x).toBe(created[0].x + created[0].width + 120);
    expect(created[0].y).toBe(0);
    expect(created[1].y).toBe(0);
  });

  it("fetches with a timeout signal so a hung backend can't stall the import forever", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        screens: [
          { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await importShowcaseScreensFromHandoff();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("places the new row to the right of existing content", async () => {
    seedScene();
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
    ]);

    await importShowcaseScreensFromHandoff();

    const { nodesById, rootIds } = useSceneStore.getState();
    // seedScene's existing roots end at rect2 (x=600, width=200) → maxX 800.
    const createdId = rootIds.find((id) => (nodesById[id] as EmbedNode).type === "embed")!;
    expect(nodesById[createdId].x).toBe(800 + 120);
  });

  it("is a single undo step", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
      { id: "screen-b", title: "Detail", width: 390, height: 844, htmlContent: "<div>Detail</div>" },
    ]);

    const pastBefore = useHistoryStore.getState().past.length;
    await importShowcaseScreensFromHandoff();

    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });

  it("a single undo fully reverts the import — scene, selection, and history all return to their pre-import state", async () => {
    // Regression test for the review finding that `saveHistory` was handed an
    // already-built `HistorySnapshot` instead of the pre-mutation state it
    // expects — calling `undo()` (rather than just counting `past.length`) is
    // what would actually have caught a corrupted snapshot.
    seedScene();
    const before = useSceneStore.getState();
    const rootIdsBefore = [...before.rootIds];
    const nodesByIdBefore = { ...before.nodesById };
    const selectionBefore = [...useSelectionStore.getState().selectedIds];

    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
      { id: "screen-b", title: "Detail", width: 390, height: 844, htmlContent: "<div>Detail</div>" },
    ]);

    expect(await importShowcaseScreensFromHandoff()).toBe(true);
    expect(useSceneStore.getState().rootIds.length).toBe(rootIdsBefore.length + 2);

    undo();

    expect(useSceneStore.getState().rootIds).toEqual(rootIdsBefore);
    expect(useSceneStore.getState().nodesById).toEqual(nodesByIdBefore);
    expect(useSelectionStore.getState().selectedIds).toEqual(selectionBefore);
  });

  it("selects the created nodes and updates the viewport", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
      { id: "screen-b", title: "Detail", width: 390, height: 844, htmlContent: "<div>Detail</div>" },
    ]);

    await importShowcaseScreensFromHandoff();

    const { rootIds } = useSceneStore.getState();
    expect(new Set(useSelectionStore.getState().selectedIds)).toEqual(new Set(rootIds));
    // fitToContent always sets a finite scale > 0 for non-empty content.
    expect(useViewportStore.getState().scale).toBeGreaterThan(0);
  });

  it("consumes the handoff so a second call does not import twice", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
    ]);

    expect(await importShowcaseScreensFromHandoff()).toBe(true);
    expect(await importShowcaseScreensFromHandoff()).toBe(false);
    expect(useSceneStore.getState().rootIds).toHaveLength(1);
  });

  it("returns false, imports nothing, and shows an error toast when the backend fetch fails", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    expect(await importShowcaseScreensFromHandoff()).toBe(false);
    expect(useSceneStore.getState().rootIds).toEqual([]);
    // #11: a failed fetch used to fail completely silently, leaving the
    // visitor in an empty editor with no explanation.
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("returns false, imports nothing, and shows an error toast when fetch throws (network error)", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect(await importShowcaseScreensFromHandoff()).toBe(false);
    expect(useSceneStore.getState().rootIds).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("does not show an error toast when there is simply no handoff to consume", async () => {
    expect(await importShowcaseScreensFromHandoff()).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not show an error toast on a successful import", async () => {
    storeShowcaseScreensHandoff({ runId: "run-1", screens: HANDOFF_SCREENS });
    stubFetchWithScreens([
      { id: "screen-a", title: "Home", width: 390, height: 844, htmlContent: "<div>Home</div>" },
    ]);

    expect(await importShowcaseScreensFromHandoff()).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });
});
