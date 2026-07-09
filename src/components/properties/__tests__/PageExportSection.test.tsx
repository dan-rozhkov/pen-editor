import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PageExportSection } from "../PageExportSection";
import { useCanvasRefStore } from "@/store/canvasRefStore";

beforeEach(() => {
  useCanvasRefStore.setState({ pixiRefs: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<PageExportSection />", () => {
  it("renders the page export action and scale selector", () => {
    render(<PageExportSection />);
    expect(screen.getByText("Export page")).toBeTruthy();
    expect(screen.getByText("Export all frames (PDF)")).toBeTruthy();
  });

  it("shows a status message when the canvas is not ready", async () => {
    render(<PageExportSection />);
    fireEvent.click(screen.getByText("Export all frames (PDF)"));
    await Promise.resolve();
    expect(screen.getByText("Canvas is not ready")).toBeTruthy();
  });
});
