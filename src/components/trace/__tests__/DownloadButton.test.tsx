import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import { DownloadButton } from "../DownloadButton";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), exportTrace: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/browseTraceFile", async (original) => ({ ...(await original<object>()), exportBrowseTrace: mocks.exportTrace }));

const download = async (notInlined: number) => {
  mocks.exportTrace.mockResolvedValue({ blob: new Blob(["{}"]), notInlined });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<DownloadButton trace={sampleTrace} />);
  fireEvent.click(screen.getByRole("button", { name: "Download trace" }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
};

describe("DownloadButton", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.toast.mockClear();
  });

  it("says nothing when every frame was inlined", async () => {
    await download(0);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("notes the frames that stay links", async () => {
    await download(2);
    expect(mocks.toast).toHaveBeenCalledWith("2 frames stay as links; the file needs network access to show them.");
  });
});
