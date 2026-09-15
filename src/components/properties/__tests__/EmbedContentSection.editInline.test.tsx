import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { EmbedContentSection } from "../EmbedContentSection";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import type { EmbedNode } from "@/types/scene";

const node = {
  id: "e1",
  type: "embed",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  htmlContent: "<div>hi</div>",
} as unknown as EmbedNode;

beforeEach(() => resetStores());
afterEach(() => cleanup());

// The "Edit inline" button is now the only way to open InlineEmbedEditor —
// it replaces the canvas-overlay EmbedActionBar's "Inline edit" button,
// which was removed when the element picker became always-on for a
// selected embed (see useEmbedPickerLifecycle).
describe("<EmbedContentSection /> edit-inline wiring", () => {
  it("opens the inline HTML editor for this node on click", () => {
    // startEditing (selectionStore.ts) is a no-op unless the target id is
    // already selected — the properties panel only ever shows for a
    // selected node in practice, but the store doesn't know that on its own.
    useSelectionStore.setState({ selectedIds: ["e1"] });
    render(<EmbedContentSection node={node} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit inline" }));

    expect(useSelectionStore.getState().editingNodeId).toBe("e1");
    expect(useSelectionStore.getState().editingMode).toBe("embed");
  });
});
