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
  it("renders the page export action with compact format and scale selectors", () => {
    render(<PageExportSection />);
    expect(screen.getByText("Export page")).toBeTruthy();
    // base-ui Select dropdowns are flaky in happy-dom (see FillSection.test.tsx),
    // so assert the selected value's label text renders rather than driving
    // the dropdown open.
    expect(screen.getByText("PNG")).toBeTruthy();
    expect(screen.getByText("1x")).toBeTruthy();
  });

  it("renders the export-all-frames button without a format suffix", () => {
    render(<PageExportSection />);
    expect(screen.getByText("Export all frames")).toBeTruthy();
  });

  it("shows a status message when the canvas is not ready", async () => {
    render(<PageExportSection />);
    fireEvent.click(screen.getByText("Export all frames"));
    await Promise.resolve();
    expect(screen.getByText("Canvas is not ready")).toBeTruthy();
  });
});
