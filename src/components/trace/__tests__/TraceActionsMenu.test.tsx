import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDocs, readDoc } from "@/lib/docs/docStore";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import { TraceActionsMenu } from "../TraceActionsMenu";
import { TraceHeader } from "../TraceHeader";

const mocks = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), loading: vi.fn(() => "progress"), dismiss: vi.fn() }), exportTrace: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/browseTraceFile", async (original) => ({ ...(await original<object>()), exportBrowseTrace: mocks.exportTrace }));

const noResult = { ...sampleTrace, answer: undefined, qa: undefined };
const withRepro: BrowseTrace = {
  ...sampleTrace,
  repro: { setup: {} },
  steps: sampleTrace.steps.map((s) => (s.index === 0 ? { ...s, repro: [{ op: "goto" as const, url: "https://acme.test/" }] } : s)),
};
const setDesktop = (value: unknown) => ((window as { penDesktop?: unknown }).penDesktop = value);
const renderMenu = (trace: BrowseTrace) => render(<TraceActionsMenu trace={trace} />);
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Trace options" }));
const item = (name: string) => screen.queryByRole("menuitem", { name: new RegExp(`^${name}`) });
/** Opens the menu and clicks one item. */
const choose = (name: string) => {
  openMenu();
  fireEvent.click(item(name)!);
};
/** Captures what the next download link saves: the blob and the file name. */
function captureDownload() {
  const saved: { blob?: Blob; name: string } = { name: "" };
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    saved.blob = b as Blob;
    return "blob:x";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.name = this.download;
  });
  return saved;
}

describe("TraceActionsMenu", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    setDesktop(undefined);
    vi.restoreAllMocks();
    mocks.toast.mockClear();
    mocks.toast.error.mockClear();
    mocks.toast.loading.mockClear();
    mocks.exportTrace.mockReset();
  });

  describe("Open result", () => {
    it("is hidden without result text", () => {
      renderMenu(noResult);
      openMenu();
      expect(item("Open result")).toBeNull();
    });

    it("is hidden on desktop shells without docs.open", () => {
      setDesktop({ onMenuCommand: () => () => {} });
      renderMenu(sampleTrace);
      openMenu();
      expect(item("Open result")).toBeNull();
    });

    it("shows the result in the run details only when the menu cannot open it", () => {
      const header = () => render(<TraceHeader trace={sampleTrace} detailsOpen onToggleDetails={() => {}} />);
      const { unmount } = header();
      fireEvent.click(screen.getByRole("button", { name: /^Run details/ }));
      expect(screen.getByText("Duration")).toBeTruthy();
      expect(screen.queryByText(/Result:/)).toBeNull();
      unmount();
      setDesktop({ onMenuCommand: () => () => {} });
      header();
      fireEvent.click(screen.getByRole("button", { name: /^Run details/ }));
      expect(screen.getByText(/Result:/).closest("p")?.textContent).toContain("The trial button is missing on the pricing page.");
    });

    it("creates a document and opens /doc?id= on the web, and reuses it the second time", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderMenu(sampleTrace);
      choose("Open result");
      const [doc] = listDocs();
      expect(listDocs()).toHaveLength(1);
      expect(doc!.title).toMatch(/^Result · Check that a visitor/);
      expect(open).toHaveBeenCalledWith(`/doc?id=${doc!.id}`, "_blank", "noopener");
      choose("Open result");
      expect(listDocs()).toHaveLength(1);
      expect(open).toHaveBeenCalledTimes(2);
      expect(open).toHaveBeenLastCalledWith(`/doc?id=${doc!.id}`, "_blank", "noopener");
    });

    it("makes a new document when the remembered one is gone", () => {
      vi.spyOn(window, "open").mockReturnValue(null);
      renderMenu(sampleTrace);
      choose("Open result");
      const first = listDocs()[0]!.id;
      localStorage.removeItem(`pen.docs.doc.${first}`);
      choose("Open result");
      expect(readDoc(first).kind).toBe("missing");
      expect(localStorage.getItem(`pen.trace.resultDoc.${sampleTrace.id}`)).not.toBe(first);
    });

    it("opens the document through the desktop bridge", () => {
      const docsOpen = vi.fn(async () => ({ ok: true }));
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      setDesktop({ docs: { open: docsOpen } });
      renderMenu(sampleTrace);
      choose("Open result");
      expect(docsOpen).toHaveBeenCalledWith(listDocs()[0]!.id);
      expect(open).not.toHaveBeenCalled();
    });

    it("shows a toast when storage is blocked", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("full");
      });
      renderMenu(sampleTrace);
      choose("Open result");
      setItem.mockRestore();
      expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/full/i));
    });

    it.each([
      ["answers an error", async () => ({ ok: false, error: "No such tab" }), "No such tab"],
      ["rejects", async () => Promise.reject(new Error("ipc")), "The document could not be opened."],
    ])("shows a toast when the desktop bridge %s, after the menu closed", async (_name, docsOpen, message) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setDesktop({ docs: { open: vi.fn(docsOpen) } });
      renderMenu(sampleTrace);
      choose("Open result");
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message));
      expect(item("Open result")).toBeNull();
    });
  });

  describe("Download trace", () => {
    it("saves the exported blob and says nothing when every frame was inlined", async () => {
      mocks.exportTrace.mockResolvedValue({ blob: new Blob(["{}"]), notInlined: 0 });
      const saved = captureDownload();
      renderMenu(sampleTrace);
      choose("Download trace");
      await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
      expect(await saved.blob!.text()).toBe("{}");
      expect(saved.name).toMatch(/\.json$/);
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("notes the frames that stay links", async () => {
      mocks.exportTrace.mockResolvedValue({ blob: new Blob(["{}"]), notInlined: 2 });
      captureDownload();
      renderMenu(sampleTrace);
      choose("Download trace");
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("2 frames stay as links; the file needs network access to show them."));
    });

    it("is disabled while the export runs", async () => {
      let finish: (v: { blob: Blob; notInlined: number }) => void = () => {};
      mocks.exportTrace.mockReturnValue(new Promise((r) => (finish = r)));
      captureDownload();
      renderMenu(sampleTrace);
      choose("Download trace");
      openMenu();
      await waitFor(() => expect(item("Download trace")!.getAttribute("aria-disabled")).toBe("true"));
      finish({ blob: new Blob(["{}"]), notInlined: 0 });
      await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    });

    it("shows progress, and turns it into the error when the export fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.exportTrace.mockRejectedValue(new Error("boom"));
      renderMenu(sampleTrace);
      choose("Download trace");
      expect(mocks.toast.loading).toHaveBeenCalledWith("Preparing the trace file…");
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Download failed, try again.", { id: "progress" }));
    });
  });

  describe("Download Playwright test", () => {
    it("is hidden for a trace recorded without repro", () => {
      renderMenu(sampleTrace);
      openMenu();
      expect(item("Download Playwright test")).toBeNull();
    });

    it("downloads the spec file of a trace with repro", async () => {
      const saved = captureDownload();
      renderMenu(withRepro);
      choose("Download Playwright test");
      expect(saved.name).toMatch(/\.spec\.ts$/);
      expect(await saved.blob!.text()).toContain("https://acme.test/");
    });

    it("has no secondary text, even when the spec has gaps", () => {
      const gapped = { ...withRepro, steps: withRepro.steps.map((s) => (s.index === 1 ? { ...s, repro: [{ op: "unknown-op" }] } : s)) } as unknown as BrowseTrace;
      renderMenu(gapped);
      openMenu();
      expect(item("Download Playwright test")!.textContent!.trim()).toBe("Download Playwright test");
    });
  });
});
