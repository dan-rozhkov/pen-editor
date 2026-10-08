import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useDesignSystemScopeStore } from "@/store/designSystemScopeStore";
import { embedDocKey, restoreEmbedDocument, saveEmbedDocument, startEmbedAutosave } from "../persistence";

beforeEach(() => {
  resetStores();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("embed persistence", () => {
  it("saves the scene and restores it into a fresh editor", () => {
    seedScene();
    expect(saveEmbedDocument("a")).toBe(true);
    expect(localStorage.getItem(embedDocKey("a"))).toContain("Screen");

    resetStores();
    expect(restoreEmbedDocument("a", { width: 800, height: 600 })).toBe(true);
    expect(Object.values(useSceneStore.getState().nodesById).map((n) => n.name)).toContain("Screen");
  });

  it("restores saved design-system scopes", () => {
    seedScene();
    useDesignSystemScopeStore.getState().setScopes([{ id: "s1", name: "Brand", collections: ["brand"] }]);
    saveEmbedDocument("a");

    resetStores();
    restoreEmbedDocument("a", { width: 800, height: 600 });
    expect(useDesignSystemScopeStore.getState().scopes).toEqual([{ id: "s1", name: "Brand", collections: ["brand"] }]);
  });

  it("keeps two widgets' documents apart", () => {
    seedScene();
    saveEmbedDocument("a");
    expect(restoreEmbedDocument("b")).toBe(false);
    expect(localStorage.getItem(embedDocKey("b"))).toBeNull();
  });

  it("restore is a no-op without saved data or with corrupt data", () => {
    expect(restoreEmbedDocument("a")).toBe(false);
    localStorage.setItem(embedDocKey("a"), "{not json");
    expect(restoreEmbedDocument("a")).toBe(false);
  });

  it("never throws when storage is denied", () => {
    const deny = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: deny, setItem: deny });
    expect(restoreEmbedDocument("a")).toBe(false);
    expect(saveEmbedDocument("a")).toBe(false);
  });

  it("autosaves debounced after scene changes and stops on dispose", () => {
    vi.useFakeTimers();
    const stop = startEmbedAutosave("a", 500);
    seedScene();
    expect(localStorage.getItem(embedDocKey("a"))).toBeNull();
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(embedDocKey("a"))).toContain("Screen");

    stop();
    localStorage.clear();
    seedScene();
    vi.advanceTimersByTime(1_000);
    expect(localStorage.getItem(embedDocKey("a"))).toBeNull();
  });

  it("autosaves when saved scopes or variables change", () => {
    vi.useFakeTimers();
    const stop = startEmbedAutosave("a", 500);
    useDesignSystemScopeStore.getState().addScope({ name: "Only scope" });
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(embedDocKey("a"))).toContain("Only scope");

    localStorage.clear();
    useVariableStore.getState().addVariable({ id: "v1", name: "--zz", type: "color", value: "#000000" });
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(embedDocKey("a"))).toContain("--zz");
    stop();
  });
});
