import { describe, it, expect, beforeEach } from "vitest";
import { getEditorState } from "@/lib/tools/getEditorState";
import { useDocumentStore } from "@/store/documentStore";
import { resetStores, seedScene } from "@/test/fixtures";

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("get_editor_state — document identity", () => {
  it("reports the current file name", async () => {
    useDocumentStore.setState({ fileName: "Launch Deck.pen" });

    const state = JSON.parse(await getEditorState({}));

    expect(state.fileName).toBe("Launch Deck.pen");
  });

  it("reports null (not undefined/omitted) for an unsaved/untitled document", async () => {
    useDocumentStore.setState({ fileName: null });

    const raw = await getEditorState({});
    expect(raw).toContain('"fileName":null');

    const state = JSON.parse(raw);
    expect(state.fileName).toBeNull();
    expect("fileName" in state).toBe(true);
  });

  it("does not include a fabricated document id — the store has none", async () => {
    const state = JSON.parse(await getEditorState({}));
    expect("documentId" in state).toBe(false);
  });

  it("stays additive alongside the existing payload shape", async () => {
    useDocumentStore.setState({ fileName: "Home.pen" });

    const state = JSON.parse(await getEditorState({}));

    expect(state.fileName).toBe("Home.pen");
    expect(Array.isArray(state.roots)).toBe(true);
    expect(Array.isArray(state.pages)).toBe(true);
    expect(Array.isArray(state.selectedIds)).toBe(true);
    expect(Array.isArray(state.selectedNodes)).toBe(true);
    expect(Array.isArray(state.reusableComponents)).toBe(true);
    expect(Array.isArray(state.documentComponents)).toBe(true);
    expect(state.viewport).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
