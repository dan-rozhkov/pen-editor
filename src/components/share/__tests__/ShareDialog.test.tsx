import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareDialog } from "@/components/share/ShareDialog";
import { useShareDialogStore } from "@/store/shareDialogStore";
import { useShareStore } from "@/store/shareStore";

const { shareMock, unshareMock, trackMock } = vi.hoisted(() => ({
  shareMock: vi.fn(),
  unshareMock: vi.fn(),
  trackMock: vi.fn(),
}));

vi.mock("@/lib/shareCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shareCanvas")>();
  return {
    ...actual,
    shareCurrentCanvas: shareMock,
    unshareCurrentCanvas: unshareMock,
    loadShareCredentials: () => null,
  };
});

vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

const writeTextMock = vi.fn();

describe("<ShareDialog />", () => {
  beforeEach(() => {
    useShareDialogStore.setState({ open: true });
    useShareStore.setState({ status: "idle", shareId: null, shareUrl: null, error: null });
    shareMock.mockReset();
    unshareMock.mockReset();
    trackMock.mockReset();
    writeTextMock.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shares the canvas and shows the URL on success", async () => {
    shareMock.mockResolvedValue({
      ok: true,
      id: "abc",
      editToken: "tok",
      url: "https://example.com/c/abc",
    });

    render(<ShareDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(screen.getByDisplayValue("https://example.com/c/abc")).toBeTruthy(),
    );
    expect(useShareStore.getState().status).toBe("shared");
  });

  it("copies the link to the clipboard", async () => {
    useShareStore.setState({
      status: "shared",
      shareId: "abc",
      shareUrl: "https://example.com/c/abc",
      error: null,
    });

    render(<ShareDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith("https://example.com/c/abc"),
    );
  });

  it("returns to idle after Stop sharing", async () => {
    useShareStore.setState({
      status: "shared",
      shareId: "abc",
      shareUrl: "https://example.com/c/abc",
      error: null,
    });
    unshareMock.mockResolvedValue({ ok: true });

    render(<ShareDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    await waitFor(() => expect(useShareStore.getState().status).toBe("idle"));
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(trackMock).toHaveBeenCalledWith("canvas_unshared", {});
  });

  // Finding G: an offline click or a 500 leaves the canvas still shared —
  // must not record "canvas_unshared" for an unshare that didn't happen.
  it("does NOT track canvas_unshared when the unshare fails", async () => {
    useShareStore.setState({
      status: "shared",
      shareId: "abc",
      shareUrl: "https://example.com/c/abc",
      error: null,
    });
    unshareMock.mockResolvedValue({ ok: false, error: "You're offline." });

    render(<ShareDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    await waitFor(() => expect(useShareStore.getState().status).toBe("error"));
    expect(trackMock).not.toHaveBeenCalledWith("canvas_unshared", {});
  });

  it("surfaces an error and lets the user retry", async () => {
    shareMock.mockResolvedValue({ ok: false, error: "Sharing failed (500)." });

    render(<ShareDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(screen.getByText("Sharing failed (500).")).toBeTruthy());

    shareMock.mockResolvedValue({
      ok: true,
      id: "abc",
      editToken: "tok",
      url: "https://example.com/c/abc",
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(screen.getByDisplayValue("https://example.com/c/abc")).toBeTruthy(),
    );
  });
});
