import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateImage, generateFrameImage } from "@/lib/tools/generateImage";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { ImagePaint } from "@/types/scene";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetStores();
  seedScene();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generate_image (chat)", () => {
  it("returns the generated url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ url: "data:image/png;base64,AAAA" })));
    const result = JSON.parse(await generateImage({ prompt: "a fox" }));
    expect(result.url).toBe("data:image/png;base64,AAAA");
    expect(result.prompt).toBe("a fox");
  });

  it("returns an error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "down" }, 500)));
    const result = JSON.parse(await generateImage({ prompt: "x" }));
    expect(result.error).toBeTruthy();
    expect(result.url).toBeUndefined();
  });

  it("fails locally without a network request when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn(async () => jsonResponse({ url: "https://cdn/x.png" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = JSON.parse(await generateImage({ prompt: "x" }));
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("generate_frame_image (canvas)", () => {
  it("applies the generated image as the frame's fill", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ url: "https://cdn/x.png" })));
    const result = JSON.parse(
      await generateFrameImage({ prompt: "a beach", frame_id: "frame1" }),
    );
    expect(result.success).toBe(true);
    expect(result.url).toBe("https://cdn/x.png");

    const frame = useSceneStore.getState().nodesById["frame1"];
    const fills = (frame as { fills?: ImagePaint[] }).fills;
    expect(fills).toHaveLength(1);
    expect(fills?.[0].type).toBe("image");
    expect(fills?.[0].image.url).toBe("https://cdn/x.png");
    expect(fills?.[0].image.mode).toBe("fill");
    // legacy fill prop cleared
    expect((frame as { imageFill?: unknown }).imageFill).toBeUndefined();
  });

  it("returns an error and does not mutate when the frame is missing", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: "https://cdn/x.png" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = JSON.parse(
      await generateFrameImage({ prompt: "x", frame_id: "nope" }),
    );
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an error and does not mutate when generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "down" }, 500)));
    const before = JSON.stringify(useSceneStore.getState().nodesById["frame1"]);
    const result = JSON.parse(
      await generateFrameImage({ prompt: "x", frame_id: "frame1" }),
    );
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(useSceneStore.getState().nodesById["frame1"])).toBe(before);
  });
});
