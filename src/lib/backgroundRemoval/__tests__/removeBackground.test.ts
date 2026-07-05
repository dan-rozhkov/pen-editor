import { describe, it, expect, afterEach, vi } from "vitest";
import { removeBackground } from "@/lib/backgroundRemoval/removeBackground";
import { REMOVE_BG_MAX_DIMENSION } from "@/lib/backgroundRemoval/constants";

// Only the pre-inference guard paths are exercised here — they throw before
// the dynamic import("onnxruntime-web") is ever reached, so no WASM runs.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubImage(width: number, height: number): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["img"], { type: "image/png" }))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close }) as unknown as ImageBitmap),
  );
  return { close };
}

describe("removeBackground guards", () => {
  it("rejects oversized images with a clear message before loading the model", async () => {
    const { close } = stubImage(REMOVE_BG_MAX_DIMENSION + 1, 500);
    await expect(removeBackground("https://cdn/huge.png")).rejects.toThrow(/too large/i);
    // The bitmap is released even on the error path.
    expect(close).toHaveBeenCalled();
  });

  it("rejects with a user-facing message when the source image cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(removeBackground("https://cdn/missing.png")).rejects.toThrow(
      /failed to load image \(404\)/i,
    );
  });
});
