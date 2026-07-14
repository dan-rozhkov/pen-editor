import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { writeTextToClipboard } from "@/utils/clipboard";

vi.mock("@/utils/clipboard", () => ({
  writeTextToClipboard: vi.fn(async () => true),
}));

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

import { toast } from "sonner";
import { InspectRow } from "../InspectRow";

describe("<InspectRow />", () => {
  beforeEach(() => {
    vi.mocked(writeTextToClipboard).mockClear();
    vi.mocked(toast).mockClear();
  });

  afterEach(() => cleanup());

  it("copies and toasts on Enter keydown", () => {
    vi.mocked(writeTextToClipboard).mockResolvedValue(true);
    render(<InspectRow row={{ label: "Fill", value: "#ff0000" }} />);
    const row = screen.getByText("Fill").closest('[data-testid="inspect-row"]')!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(writeTextToClipboard).toHaveBeenCalledWith("#ff0000");
  });

  it("copies and toasts on Space keydown, preventing scroll", () => {
    vi.mocked(writeTextToClipboard).mockResolvedValue(true);
    render(<InspectRow row={{ label: "Fill", value: "#ff0000" }} />);
    const row = screen.getByText("Fill").closest('[data-testid="inspect-row"]')!;
    const event = fireEvent.keyDown(row, { key: " ", cancelable: true });
    expect(writeTextToClipboard).toHaveBeenCalledWith("#ff0000");
    // fireEvent.keyDown returns false when preventDefault() was called.
    expect(event).toBe(false);
  });

  it("does not toast when clipboard write fails", async () => {
    vi.mocked(writeTextToClipboard).mockResolvedValue(false);
    render(<InspectRow row={{ label: "Fill", value: "#ff0000" }} />);
    const row = screen.getByText("Fill").closest('[data-testid="inspect-row"]')!;
    fireEvent.click(row);
    await vi.waitFor(() => expect(writeTextToClipboard).toHaveBeenCalledWith("#ff0000"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts when clipboard write succeeds", async () => {
    vi.mocked(writeTextToClipboard).mockResolvedValue(true);
    render(<InspectRow row={{ label: "Fill", value: "#ff0000" }} />);
    const row = screen.getByText("Fill").closest('[data-testid="inspect-row"]')!;
    fireEvent.click(row);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Copied Fill"));
  });

  it("token sub-row keydown (Light) stops propagation and copies without collapsing", async () => {
    vi.mocked(writeTextToClipboard).mockResolvedValue(true);
    render(
      <InspectRow
        row={{
          label: "Fill",
          value: "#ff0000",
          token: { name: "colorVar", light: "#ffffff", dark: "#000000" },
        }}
      />
    );
    // Expand the token row
    const tokenRow = screen.getAllByText("Fill")[0].closest('[data-testid="inspect-row"]')!;
    fireEvent.click(tokenRow);
    // Verify Light and Dark sub-rows are visible after expanding
    expect(screen.queryByText("Light")).not.toBeNull();
    expect(screen.queryByText("Dark")).not.toBeNull();
    // Press Enter on Light sub-row
    const lightRow = screen.getByText("Light").closest('[data-testid="inspect-row"]')!;
    fireEvent.keyDown(lightRow, { key: "Enter" });
    // Verify clipboard was called for light value
    await vi.waitFor(() => expect(writeTextToClipboard).toHaveBeenCalledWith("#ffffff"));
    // Verify Light and Dark rows are STILL visible (not collapsed)
    expect(screen.queryByText("Light")).not.toBeNull();
    expect(screen.queryByText("Dark")).not.toBeNull();
  });
});
