import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDocs, readDoc } from "@/lib/docs/docStore";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import { ResultButton } from "../ResultButton";
import { TraceHeader } from "../TraceHeader";

const button = () => screen.queryByRole("button", { name: "Open result" });
const noResult = { ...sampleTrace, answer: undefined, qa: undefined };
const setDesktop = (value: unknown) => ((window as { penDesktop?: unknown }).penDesktop = value);

describe("ResultButton", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    setDesktop(undefined);
    vi.restoreAllMocks();
  });

  it("is hidden without result text", () => {
    render(<ResultButton trace={noResult} />);
    expect(button()).toBeNull();
  });

  it("is hidden on desktop shells without docs.open", () => {
    setDesktop({ onMenuCommand: () => () => {} });
    render(<ResultButton trace={sampleTrace} />);
    expect(button()).toBeNull();
  });

  it("shows the result line in the header only when the button cannot open it", () => {
    const { unmount } = render(<TraceHeader trace={sampleTrace} />);
    expect(screen.queryByText(/Result:/)).toBeNull();
    unmount();
    setDesktop({ onMenuCommand: () => () => {} });
    render(<TraceHeader trace={sampleTrace} />);
    expect(screen.getByText(/Result:/).closest("p")?.getAttribute("title")).toBe("The trial button is missing on the pricing page.");
  });

  it("creates a document and opens /doc?id= on the web, and reuses it the second time", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ResultButton trace={sampleTrace} />);
    fireEvent.click(button()!);
    const [doc] = listDocs();
    expect(listDocs()).toHaveLength(1);
    expect(doc!.title).toMatch(/^Result · Check that a visitor/);
    expect(open).toHaveBeenCalledWith(`/doc?id=${doc!.id}`, "_blank", "noopener");
    fireEvent.click(button()!);
    expect(listDocs()).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(`/doc?id=${doc!.id}`, "_blank", "noopener");
  });

  it("makes a new document when the remembered one is gone", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<ResultButton trace={sampleTrace} />);
    fireEvent.click(button()!);
    const first = listDocs()[0]!.id;
    localStorage.removeItem(`pen.docs.doc.${first}`);
    fireEvent.click(button()!);
    expect(readDoc(first).kind).toBe("missing");
    expect(localStorage.getItem(`pen.trace.resultDoc.${sampleTrace.id}`)).not.toBe(first);
  });

  it("opens the document through the desktop bridge", () => {
    const docsOpen = vi.fn(async () => ({ ok: true }));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setDesktop({ docs: { open: docsOpen } });
    render(<ResultButton trace={sampleTrace} />);
    fireEvent.click(button()!);
    expect(docsOpen).toHaveBeenCalledWith(listDocs()[0]!.id);
    expect(open).not.toHaveBeenCalled();
  });

  it("shows an inline error when storage is blocked", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    render(<ResultButton trace={sampleTrace} />);
    fireEvent.click(button()!);
    expect(screen.getByRole("alert").textContent).toMatch(/storage/i);
  });
});
