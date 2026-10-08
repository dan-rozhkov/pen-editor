import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { shareCurrentCanvas } from "@/lib/shareCanvas";
import { restoreEmbedDocument, saveEmbedDocument } from "@/embed/persistence";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { deserializeDocument, serializeDocument, serializeDocumentData } from "@/utils/fileUtils";
import { useDocumentStore } from "@/store/documentStore";
import { useVariableStore } from "@/store/variableStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import { resetWorld, seedEmbed } from "@/test/componentFixtures";
import { assertDefined } from "@/test/assertions";
import type { Variable, VariableCollection } from "@/types/variable";
import type { EmbedNode } from "@/types/scene";
import type { LibraryAuthor, LibraryPin } from "@/lib/designSystem";

const PIN: LibraryPin = { id: "lib_acme", name: "Acme", version: "1.2.0", reportUsage: true, dismissedVersion: "1.3.0" };
const AUTHOR: LibraryAuthor = { libraryId: "lib_mine", baseVersion: "0.4.0", name: "Mine" };
const COLLECTION: VariableCollection = {
  id: "col_lib",
  name: "Density",
  modes: [{ id: "compact", name: "Compact" }],
  defaultModeId: "compact",
  libraryId: "lib_acme",
};
const LIB_VAR: Variable = {
  id: "var_space",
  name: "Space",
  type: "number",
  collectionId: "col_lib",
  valuesByMode: { compact: "4" },
  value: "4",
  libraryId: "lib_acme",
};

function seedLibraryDocument(): void {
  resetWorld();
  const theme = useVariableStore.getState().collections[0];
  useVariableStore.getState().replaceAll([LIB_VAR], [theme, COLLECTION]);
  seedEmbed("master", "<div data-c='btn'></div>", {
    component: { key: "btn", name: "Button", library: { id: "lib_acme", version: "1.2.0" } },
  });
  useDocumentStore.getState().setLibraryState({ documentId: "doc-1", libraries: [PIN], libraryAuthor: AUTHOR });
}

beforeEach(() => {
  resetStores();
  localStorage.clear();
});

describe("library state in .pen documents", () => {
  it("round-trips documentId, pins and the author through serialize/deserialize", () => {
    const json = serializeDocument([], [], "light", [], [], [], undefined, undefined, undefined, {
      documentId: "doc-1",
      libraries: [PIN],
      libraryAuthor: AUTHOR,
    });
    expect(JSON.parse(json).version).toBe("1.3");
    expect(deserializeDocument(json)).toMatchObject({ documentId: "doc-1", libraries: [PIN], libraryAuthor: AUTHOR });
  });

  it("omits the fields when there is nothing to say", () => {
    const doc = JSON.parse(serializeDocument([], [], "light"));
    expect(doc).not.toHaveProperty("documentId");
    expect(doc).not.toHaveProperty("libraries");
    expect(doc).not.toHaveProperty("libraryAuthor");
  });

  it("loads an older file (1.2) without library fields", () => {
    const data = deserializeDocument(JSON.stringify({ version: "1.2", pages: [] }));
    expect(data.documentId).toBeUndefined();
    expect(data.libraries).toBeUndefined();
  });

  it("drops malformed pins instead of failing the load", () => {
    const data = deserializeDocument(
      JSON.stringify({ version: "1.3", libraries: [{ id: "a", version: "1.0.0" }, { id: 5 }, { id: "a", version: "2.0.0" }, null], libraryAuthor: { libraryId: 1 } }),
    );
    expect(data.libraries).toEqual([{ id: "a", name: "a", version: "1.0.0" }]);
    expect(data.libraryAuthor).toBeUndefined();
  });

  it("keeps libraryId on variables and collections, and component.library on masters", () => {
    seedLibraryDocument();
    const json = serializeDocumentData(collectDocumentData());
    const reopened = deserializeDocument(json);
    expect(reopened.variables[0].libraryId).toBe("lib_acme");
    expect(reopened.variableCollections?.find((c) => c.id === "col_lib")?.libraryId).toBe("lib_acme");
    const master = reopened.pages[0].nodes.find((n) => n.id === "master") as EmbedNode | undefined;
    assertDefined(master);
    expect(master.component?.library).toEqual({ id: "lib_acme", version: "1.2.0" });
  });
});

describe("document identity and pins in the editor", () => {
  it("mints a documentId on first save and keeps it", () => {
    resetWorld();
    expect(useDocumentStore.getState().documentId).toBeNull();
    const first = collectDocumentData().documentId;
    expect(first).toBeTruthy();
    expect(collectDocumentData().documentId).toBe(first);
  });

  it("applyOpenedDocument restores pins and flags, and mints an id for a file without one", () => {
    seedLibraryDocument();
    const data = deserializeDocument(serializeDocumentData(collectDocumentData()));
    resetWorld();
    applyOpenedDocument(data, { viewportWidth: 800, viewportHeight: 600 });
    expect(useDocumentStore.getState()).toMatchObject({ documentId: "doc-1", libraries: [PIN], libraryAuthor: AUTHOR });
    expect(useVariableStore.getState().variables[0].libraryId).toBe("lib_acme");
    const master = useSceneStore.getState().nodesById.master as unknown as EmbedNode | undefined;
    expect(master?.component?.library?.version).toBe("1.2.0");

    applyOpenedDocument(deserializeDocument(JSON.stringify({ version: "1.2", pages: [] })), { viewportWidth: 800, viewportHeight: 600 });
    expect(useDocumentStore.getState().documentId).toBeTruthy();
    expect(useDocumentStore.getState().documentId).not.toBe("doc-1");
    expect(useDocumentStore.getState().libraries).toEqual([]);
  });

  it("the embed autosave persists and restores the library state", () => {
    seedLibraryDocument();
    expect(saveEmbedDocument("w1")).toBe(true);
    resetWorld();
    expect(restoreEmbedDocument("w1", { width: 800, height: 600 })).toBe(true);
    expect(useDocumentStore.getState().libraries).toEqual([PIN]);
    expect(useVariableStore.getState().variables[0].libraryId).toBe("lib_acme");
  });
});

describe("shared canvases", () => {
  it("keep the pins but strip reportUsage, the document id and the author", async () => {
    seedLibraryDocument();
    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "s1", editToken: "t" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await shareCurrentCanvas();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const shared = JSON.parse(JSON.parse(init.body as string).document);
    expect(shared.libraries).toEqual([{ id: "lib_acme", name: "Acme", version: "1.2.0", dismissedVersion: "1.3.0" }]);
    expect(shared).not.toHaveProperty("documentId");
    expect(shared).not.toHaveProperty("libraryAuthor");
    vi.unstubAllGlobals();
  });
});
