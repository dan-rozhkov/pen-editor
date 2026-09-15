import { describe, it, expect, beforeEach } from "vitest";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import { resetStores } from "@/test/fixtures";
import type { DocumentData } from "@/utils/fileUtils";
import type { SceneNode } from "@/types/scene";

/**
 * Regression: the legacy-`ref` migration must run on the REAL document-open
 * path. It used to live only inside `sceneStore.setNodes`, which no
 * production code calls — so every `.pen` file written before components were
 * removed opened with its instances as empty, invisible boxes.
 */
describe("applyOpenedDocument migrates legacy component instances", () => {
  beforeEach(() => {
    resetStores();
  });

  function legacyDoc(): DocumentData {
    // `ref`/`reusable` no longer exist in the live SceneNode union — an old
    // document on disk still carries them, which is the whole point here.
    const comp = {
      id: "comp",
      type: "frame",
      name: "Card",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      reusable: true,
      children: [
        { id: "compChild", type: "text", name: "Title", x: 8, y: 8, width: 100, height: 20, content: "Hello", children: [] },
      ],
    } as unknown as SceneNode;
    const instance = {
      id: "inst",
      type: "ref",
      name: "Card Instance",
      x: 40,
      y: 60,
      width: 200,
      height: 120,
      componentId: "comp",
    } as unknown as SceneNode;

    return {
      pages: [
        { id: "p1", name: "Page 1", nodes: [comp] },
        { id: "p2", name: "Page 2", nodes: [instance] },
      ],
      variables: [],
      activeTheme: "light",
    } as unknown as DocumentData;
  }

  it("turns a ref into real content and strips reusable, across pages", () => {
    applyOpenedDocument(legacyDoc(), { viewportWidth: 1000, viewportHeight: 800 });

    // Page 1 (the active page) keeps the master, minus the component flag.
    const scene = useSceneStore.getState();
    const master = scene.nodesById.comp as unknown as { type: string; reusable?: boolean };
    expect(master.type).toBe("frame");
    expect(master.reusable).toBeUndefined();

    // Page 2's instance resolved against the master on page 1.
    const page2 = usePageStore.getState().pages.find((p) => p.id === "p2");
    expect(page2).toBeDefined();
    const inst = page2!.nodesById.inst as unknown as { type: string; name?: string };
    expect(inst.type).toBe("frame");
    expect(inst.name).toBe("Card Instance");

    const childIds = page2!.childrenById.inst ?? [];
    expect(childIds).toHaveLength(1);
    const child = page2!.nodesById[childIds[0]] as unknown as { type: string; name?: string };
    expect(child.type).toBe("text");
    expect(child.name).toBe("Title");

    // No `ref` node survives anywhere in the opened document.
    for (const page of usePageStore.getState().pages) {
      for (const node of Object.values(page.nodesById)) {
        expect((node as unknown as { type: string }).type).not.toBe("ref");
      }
    }
  });
});
