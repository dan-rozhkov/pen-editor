import { describe, it, expect, beforeEach } from "vitest";
import { serializeDocument, deserializeDocument } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { DesignSystemScope } from "@/types/designSystemScope";

const PAGES = [{ id: "p1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5" }];
const SCOPES: DesignSystemScope[] = [
  { id: "s1", name: "Brand only", collections: ["brand"], tokenScopes: ["fill"] },
  { id: "s2", name: "Buttons", components: { keys: ["btn"] } },
];

const serialize = (scopes?: DesignSystemScope[]) =>
  serializeDocument(PAGES, [], "light", [], [], [], undefined, undefined, scopes);

describe(".pen designSystemScopes", () => {
  beforeEach(() => resetStores());

  it("round-trips through serializeDocument/deserializeDocument", () => {
    expect(deserializeDocument(serialize(SCOPES)).designSystemScopes).toEqual(SCOPES);
  });

  it("omits the key when there are no scopes and reads a legacy file as none", () => {
    expect(JSON.parse(serialize([]))).not.toHaveProperty("designSystemScopes");
    expect(JSON.parse(serialize())).not.toHaveProperty("designSystemScopes");
    expect(deserializeDocument(JSON.stringify({ version: "1.0", nodes: [] })).designSystemScopes).toEqual([]);
  });

  it("drops malformed entries on read", () => {
    const json = JSON.stringify({ version: "1.2", pages: [], designSystemScopes: [SCOPES[0], { id: 3 }, "x"] });
    expect(deserializeDocument(json).designSystemScopes).toEqual([SCOPES[0]]);
  });

  it("opening a document replaces the store's scopes, and a document without any clears them", () => {
    useDesignSystemScopeStore.getState().addScope({ name: "Stale" });
    applyOpenedDocument(deserializeDocument(serialize(SCOPES)), { viewportWidth: 800, viewportHeight: 600 });
    expect(useDesignSystemScopeStore.getState().scopes).toEqual(SCOPES);

    applyOpenedDocument(deserializeDocument(serialize([])), { viewportWidth: 800, viewportHeight: 600 });
    expect(useDesignSystemScopeStore.getState().scopes).toEqual([]);
  });

  it("collectDocumentData returns the live scopes", () => {
    seedScene();
    useDesignSystemScopeStore.getState().setScopes(SCOPES);
    expect(collectDocumentData().designSystemScopes).toEqual(SCOPES);
  });
});
