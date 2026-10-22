import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { exportDocPdf } from "@/lib/docs/docPdf";

type W = { penDesktop?: unknown; print: () => void };
const w = window as unknown as W;

describe("exportDocPdf", () => {
  let print: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    toast.mockClear();
    toast.error.mockClear();
    print = vi.fn();
    w.print = print as unknown as () => void;
    delete w.penDesktop;
  });
  afterEach(() => {
    delete w.penDesktop;
  });

  it("uses the shell with <title>.pdf and toasts the saved file name", async () => {
    const exportPdf = vi.fn().mockResolvedValue({ ok: true, path: "/Users/me/Docs/My plan.pdf" });
    w.penDesktop = { docs: { exportPdf } };
    await exportDocPdf("My plan");
    expect(exportPdf).toHaveBeenCalledWith("My plan.pdf");
    expect(toast).toHaveBeenCalledWith("Saved My plan.pdf");
    expect(print).not.toHaveBeenCalled();
  });

  it("handles Windows paths", async () => {
    w.penDesktop = { docs: { exportPdf: vi.fn().mockResolvedValue({ ok: true, path: "C:\\Docs\\a.pdf" }) } };
    await exportDocPdf("a");
    expect(toast).toHaveBeenCalledWith("Saved a.pdf");
  });

  it("stays silent when the user cancels", async () => {
    w.penDesktop = { docs: { exportPdf: vi.fn().mockResolvedValue({ canceled: true }) } };
    await exportDocPdf("a");
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it("shows an error toast on an error result", async () => {
    w.penDesktop = { docs: { exportPdf: vi.fn().mockResolvedValue({ error: "disk full" }) } };
    await exportDocPdf("a");
    expect(toast.error).toHaveBeenCalledWith("Could not save the PDF: disk full");
  });

  it("falls back to window.print when the bridge answers Not allowed.", async () => {
    w.penDesktop = { docs: { exportPdf: vi.fn().mockResolvedValue({ error: "Not allowed." }) } };
    await exportDocPdf("a");
    expect(print).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows an error toast when the call rejects", async () => {
    w.penDesktop = { docs: { exportPdf: vi.fn().mockRejectedValue(new Error("boom")) } };
    await exportDocPdf("a");
    expect(toast.error).toHaveBeenCalledWith("Could not save the PDF: boom");
  });

  it("falls back to window.print without a bridge", async () => {
    await exportDocPdf("a");
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("falls back to window.print on an older shell without exportPdf", async () => {
    w.penDesktop = { docs: {} };
    await exportDocPdf("a");
    expect(print).toHaveBeenCalledTimes(1);
  });
});
