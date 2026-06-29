import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { EmbedActionBar } from "../EmbedActionBar";
import { useEditorModeStore } from "@/store/editorModeStore";
import type { EmbedNode } from "@/types/scene";

afterEach(() => cleanup());

const node = {
  id: "e1",
  type: "embed",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  htmlContent: "<div>hi</div>",
} as unknown as EmbedNode;

describe("<EmbedActionBar /> view-mode gating", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("renders edit affordances in edit mode", () => {
    render(<EmbedActionBar node={node} absoluteX={0} absoluteY={0} />);
    expect(screen.getByLabelText("Inline edit")).toBeTruthy();
  });

  it("renders nothing in view mode", () => {
    useEditorModeStore.setState({ mode: "view" });
    const { container } = render(<EmbedActionBar node={node} absoluteX={0} absoluteY={0} />);
    expect(container.firstChild).toBeNull();
  });
});
