import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LayersPanel } from "../LayersPanel";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

describe("<LayersPanel />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows an empty state when there are no layers", () => {
    render(<LayersPanel />);
    expect(screen.getByText("No layers yet")).toBeTruthy();
  });

  it("renders a row for each top-level layer from the scene store", () => {
    seedScene();
    render(<LayersPanel />);

    // frame1 "Screen" and rect2 "Floating" are the top-level nodes; frame1 is
    // collapsed by default so its children are not rendered.
    expect(screen.getByText("Screen")).toBeTruthy();
    expect(screen.getByText("Floating")).toBeTruthy();
    expect(screen.queryByText("Box")).toBeNull(); // child of collapsed frame1
    expect(screen.queryByText("No layers yet")).toBeNull();
  });

  it("renders nested children once their parent frame is expanded", () => {
    seedScene();
    useSceneStore.getState().setFrameExpanded("frame1", true);
    render(<LayersPanel />);

    expect(screen.getByText("Screen")).toBeTruthy();
    expect(screen.getByText("Box")).toBeTruthy(); // rect1
    expect(screen.getByText("Title")).toBeTruthy(); // text1
  });
});
