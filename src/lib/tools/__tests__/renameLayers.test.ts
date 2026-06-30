import { describe, it, expect, beforeEach } from "vitest";
import { renameLayers } from "@/lib/tools/renameLayers";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";

function sceneState() {
  return useSceneStore.getState();
}

describe("rename_layers", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("renames multiple layers by id", async () => {
    const result = JSON.parse(
      await renameLayers({
        renames: [
          { id: "frame1", name: "Login screen" },
          { id: "text1", name: "Title heading" },
        ],
      })
    );

    expect(result.renamed).toBe(2);
    expect(result.skipped).toEqual([]);

    const { nodesById } = sceneState();
    expect(nodesById.frame1.name).toBe("Login screen");
    expect(nodesById.text1.name).toBe("Title heading");
  });

  it("trims whitespace from new names", async () => {
    await renameLayers({ renames: [{ id: "rect1", name: "  Avatar box  " }] });
    expect(sceneState().nodesById.rect1.name).toBe("Avatar box");
  });

  it("reports unknown ids in skipped without failing the batch", async () => {
    const result = JSON.parse(
      await renameLayers({
        renames: [
          { id: "frame1", name: "Card" },
          { id: "does-not-exist", name: "Ghost" },
        ],
      })
    );

    expect(result.renamed).toBe(1);
    expect(result.skipped).toEqual(["does-not-exist"]);
    expect(sceneState().nodesById.frame1.name).toBe("Card");
  });

  it("skips entries whose name is blank after trimming", async () => {
    const result = JSON.parse(
      await renameLayers({
        renames: [
          { id: "rect1", name: "   " },
          { id: "rect2", name: "Sidebar" },
        ],
      })
    );

    expect(result.renamed).toBe(1);
    expect(result.skipped).toEqual(["rect1"]);
    expect(sceneState().nodesById.rect1.name).toBe("Box"); // unchanged from fixture
    expect(sceneState().nodesById.rect2.name).toBe("Sidebar");
  });

  it("creates exactly one undo entry for a multi-rename batch", async () => {
    const before = useHistoryStore.getState().past.length;
    await renameLayers({
      renames: [
        { id: "frame1", name: "A" },
        { id: "rect1", name: "B" },
        { id: "text1", name: "C" },
      ],
    });
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
  });

  it("accepts a JSON-string renames payload", async () => {
    const result = JSON.parse(
      await renameLayers({
        renames: JSON.stringify([{ id: "rect2", name: "Floating panel" }]),
      })
    );
    expect(result.renamed).toBe(1);
    expect(sceneState().nodesById.rect2.name).toBe("Floating panel");
  });

  it("returns an error and leaves the store untouched for empty input", async () => {
    const before = useHistoryStore.getState().past.length;
    const result = JSON.parse(await renameLayers({ renames: [] }));
    expect(result.error).toBeTruthy();
    expect(result.renamed).toBeUndefined();
    expect(useHistoryStore.getState().past.length).toBe(before);
    expect(sceneState().nodesById.frame1.name).toBe("Screen"); // unchanged
  });

  it("returns an error when renames is missing entirely", async () => {
    const result = JSON.parse(await renameLayers({}));
    expect(result.error).toBeTruthy();
  });
});
