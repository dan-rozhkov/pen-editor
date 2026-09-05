import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadDocument, downloadPublicPen } from "@/utils/fileUtils";

/**
 * Regression guard for the .json/.pen export download (both go through the
 * same `downloadTextFile` helper). The shipped bug revoked the object URL
 * synchronously in the same task as `anchor.click()`, and clicked an anchor
 * that was never in the document — Chrome resolves a blob: download on a
 * later task, so the URL was already dead and nothing reached disk.
 *
 * These tests assert the observable DOM/URL behaviour, not that some helper
 * was called: a mocked-out `saveBlob` would have passed against the broken
 * code too, which is the gap that let this ship.
 */
describe("document download (downloadDocument / downloadPublicPen)", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let originalCreate: typeof URL.createObjectURL | undefined;
  let originalRevoke: typeof URL.revokeObjectURL | undefined;
  /** Anchor state captured at the instant click() fired. */
  let clickState: { inDocument: boolean; href: string; download: string; revokeCalls: number } | null;

  beforeEach(() => {
    vi.useFakeTimers();
    clickState = null;

    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickState = {
        inDocument: document.body.contains(this),
        href: this.getAttribute("href") ?? "",
        download: this.download,
        revokeCalls: revokeObjectURL.mock.calls.length,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalCreate) URL.createObjectURL = originalCreate;
    if (originalRevoke) URL.revokeObjectURL = originalRevoke;
  });

  function exportJson(): void {
    downloadDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5" }],
      [],
      "light",
      {},
      "my-doc.json",
    );
  }

  it("attaches the anchor to the document before clicking it", () => {
    exportJson();

    expect(clickState).not.toBeNull();
    expect(clickState!.inDocument).toBe(true);
    expect(clickState!.href).toBe("blob:mock-url");
    expect(clickState!.download).toBe("my-doc.json");
  });

  it("does not revoke the object URL in the same task as the click", () => {
    exportJson();

    // The revoke that killed the download happened here, synchronously.
    expect(clickState!.revokeCalls).toBe(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("revokes the object URL only after the download has had a chance to start", () => {
    exportJson();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("removes the anchor from the document once the click has fired", () => {
    exportJson();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("serializes the document as an application/json blob", async () => {
    exportJson();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text()).pages[0].id).toBe("page-1");
  });

  it("applies the same deferred-revoke behaviour to the .pen export", () => {
    downloadPublicPen([], [], "light", "my-doc.pen");

    expect(clickState).not.toBeNull();
    expect(clickState!.inDocument).toBe(true);
    expect(clickState!.download).toBe("my-doc.pen");
    expect(clickState!.revokeCalls).toBe(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
