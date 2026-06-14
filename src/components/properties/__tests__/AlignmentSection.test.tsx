import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AlignmentSection } from "../AlignmentSection";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FrameNode } from "@/types/scene";

function getNodes() {
  return useSceneStore.getState().getNodes();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

describe("<AlignmentSection />", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  afterEach(() => cleanup());

  // seedScene root nodes: frame1 (100,100 400x300) and rect2 (600,100 200x100)

  it("aligns selected nodes to the left and records history", () => {
    render(
      <AlignmentSection count={2} selectedIds={["frame1", "rect2"]} nodes={getNodes()} />,
    );
    const before = pastLen();

    fireEvent.click(screen.getByTitle("Align left"));

    // left edge = min(100, 600) = 100 -> rect2 moves to x=100
    expect(useSceneStore.getState().nodesById["rect2"].x).toBe(100);
    expect(pastLen()).toBe(before + 1);
  });

  it("aligns selected nodes to the right edge", () => {
    render(
      <AlignmentSection count={2} selectedIds={["frame1", "rect2"]} nodes={getNodes()} />,
    );

    fireEvent.click(screen.getByTitle("Align right"));

    // right edge = max(500, 800) = 800 -> frame1 (w400) moves to x=400
    expect(useSceneStore.getState().nodesById["frame1"].x).toBe(400);
  });

  it("shows the spacing section and selection count for multi-select", () => {
    render(
      <AlignmentSection count={2} selectedIds={["frame1", "rect2"]} nodes={getNodes()} />,
    );
    expect(screen.getByText("Spacing")).toBeTruthy();
    expect(screen.getByText("2 layers selected")).toBeTruthy();
  });

  it("hides spacing and count for a single node inside a frame", () => {
    const frame1 = getNodes().find((n) => n.id === "frame1") as FrameNode;
    render(
      <AlignmentSection
        count={1}
        selectedIds={["rect1"]}
        nodes={getNodes()}
        parentFrame={frame1}
      />,
    );
    // alignment buttons still render
    expect(screen.getByTitle("Align left")).toBeTruthy();
    // but spacing + count are hidden
    expect(screen.queryByText("Spacing")).toBeNull();
    expect(screen.queryByText(/layers selected/)).toBeNull();
  });
});
