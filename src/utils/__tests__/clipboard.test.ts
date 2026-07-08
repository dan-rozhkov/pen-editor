import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeTextToClipboard } from "../clipboard";

describe("writeTextToClipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("writes text via navigator.clipboard.writeText and returns true", async () => {
    const result = await writeTextToClipboard("hello world");

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("returns false without calling the clipboard for empty text", async () => {
    const result = await writeTextToClipboard("");

    expect(result).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back and swallows the error when navigator.clipboard.writeText rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // happy-dom has no document.execCommand, so the fallback also fails —
    // this asserts the failure path never throws and resolves to false.
    const result = await writeTextToClipboard("hello world");

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
