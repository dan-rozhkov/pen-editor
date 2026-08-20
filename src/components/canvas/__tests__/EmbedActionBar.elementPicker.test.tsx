import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { act } from "@testing-library/react";
import { EmbedActionBar } from "../EmbedActionBar";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
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

afterEach(() => cleanup());

beforeEach(() => {
  useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  useEmbedPickerStore.getState().reset();
});

describe("<EmbedActionBar /> element picker button", () => {
  it("renders a 'Select element' button that starts picking mode for this node", () => {
    render(<EmbedActionBar node={node} absoluteX={0} absoluteY={0} />);
    const button = screen.getByLabelText("Select element");

    fireEvent.click(button);

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
  });

  it("clicking again exits picking mode and relabels to 'Exit element select'", () => {
    render(<EmbedActionBar node={node} absoluteX={0} absoluteY={0} />);
    fireEvent.click(screen.getByLabelText("Select element"));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    // aria-label follows the tooltip text, which flips once picking starts.
    const active = screen.getByLabelText("Exit element select");
    fireEvent.click(active);

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });

  it("reflects an externally-started pick for this node as active", () => {
    render(<EmbedActionBar node={node} absoluteX={0} absoluteY={0} />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));
    expect(screen.getByLabelText("Exit element select")).toBeTruthy();
  });

  it("is hidden in view mode along with the rest of the action bar", () => {
    useEditorModeStore.setState({ mode: "view" });
    render(<EmbedActionBar node={node} absoluteX={0} absoluteY={0} />);
    expect(screen.queryByLabelText("Select element")).toBeNull();
  });
});
