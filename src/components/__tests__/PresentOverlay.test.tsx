import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PresentOverlay } from "@/components/PresentOverlay";
import { useEditorModeStore } from "@/store/editorModeStore";

afterEach(() => cleanup());

describe("<PresentOverlay />", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "present", presentFrameIds: ["a", "b", "c"], presentIndex: 1 });
  });

  it("shows a 1-based counter", () => {
    render(<PresentOverlay />);
    expect(screen.getByTestId("present-counter").textContent).toContain("2 / 3");
  });

  it("navigates and exits", () => {
    render(<PresentOverlay />);
    fireEvent.click(screen.getByTestId("present-next"));
    expect(useEditorModeStore.getState().presentIndex).toBe(2);
    fireEvent.click(screen.getByTestId("present-prev"));
    expect(useEditorModeStore.getState().presentIndex).toBe(1);
    fireEvent.click(screen.getByTestId("present-exit"));
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });
});
