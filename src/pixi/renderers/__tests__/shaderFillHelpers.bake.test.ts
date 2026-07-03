import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";

// applyShaderFill's async bake pipeline (in-flight coalescing + bounded retry)
// is otherwise only exercisable through the untestable WebGL bake itself, so
// stub the two async boundaries it calls through.
vi.mock("@/lib/shaders/shaderRaster", () => ({
  rasterizeShader: vi.fn(),
}));
vi.mock("@/lib/shaders/nodeRaster", () => ({
  extractNodeImage: vi.fn(),
}));

const { rasterizeShader } = await import("@/lib/shaders/shaderRaster");
const { applyShaderFill } = await import("../shaderFillHelpers");

function rectNode(over: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return {
    id: "n1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    shader: { kind: "waves", params: {} },
    ...over,
  } as FlatSceneNode;
}

function containerWithBg(): Container {
  const c = new Container();
  const bg = new Graphics();
  bg.label = "rect-bg";
  c.addChild(bg);
  return c;
}

/** Let queued microtasks (promise chains inside applyShaderFill) settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const mockRasterize = vi.mocked(rasterizeShader);

describe("applyShaderFill — in-flight coalescing", () => {
  beforeEach(() => {
    mockRasterize.mockReset();
  });

  it("does not start a second concurrent bake for the same container; runs one follow-up with the latest args", async () => {
    let resolveFirst!: (t: Texture | null) => void;
    const first = new Promise<Texture | null>((resolve) => {
      resolveFirst = resolve;
    });
    mockRasterize.mockReturnValueOnce(first);

    const c = containerWithBg();
    applyShaderFill(c, rectNode(), 100, 80);
    await flush();
    expect(mockRasterize).toHaveBeenCalledTimes(1);

    // A second request arrives while the first is still in flight — must not
    // trigger a second concurrent rasterizeShader call.
    applyShaderFill(c, rectNode(), 200, 150);
    await flush();
    expect(mockRasterize).toHaveBeenCalledTimes(1);

    // A third request supersedes the second's remembered args.
    applyShaderFill(c, rectNode(), 300, 90);
    await flush();
    expect(mockRasterize).toHaveBeenCalledTimes(1);

    // Resolve the in-flight bake; exactly one follow-up bake should fire,
    // using the latest (300x90) request, not the intermediate (200x150) one.
    mockRasterize.mockReturnValueOnce(Promise.resolve(Texture.WHITE));
    resolveFirst(Texture.WHITE);
    await flush();
    await flush();

    expect(mockRasterize).toHaveBeenCalledTimes(2);
    expect(mockRasterize).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "waves" }),
      300,
      90,
      undefined,
    );
  });
});

describe("applyShaderFill — bounded retry on null bake", () => {
  beforeEach(() => {
    mockRasterize.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries once ~300ms after a null result, then succeeds", async () => {
    mockRasterize.mockResolvedValueOnce(null);
    mockRasterize.mockResolvedValueOnce(Texture.WHITE);

    const c = containerWithBg();
    applyShaderFill(c, rectNode(), 100, 80);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockRasterize).toHaveBeenCalledTimes(1);
    // No retry yet — under the 300ms delay.
    await vi.advanceTimersByTimeAsync(100);
    expect(mockRasterize).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(mockRasterize).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(c.getChildByLabel("shader-fill")).toBeTruthy();
  });

  it("warns once and degrades to shader-less if the retry also fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRasterize.mockResolvedValueOnce(null);
    mockRasterize.mockResolvedValueOnce(null);

    const c = containerWithBg();
    applyShaderFill(c, rectNode(), 100, 80);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRasterize).toHaveBeenCalledTimes(2);
    expect(c.getChildByLabel("shader-fill")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("skips the stale-size retry (no warn) when a newer request is coalesced during the retry window; follow-up uses the latest args", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // First bake attempt (size 100x80) fails and enters the 300ms retry wait.
    mockRasterize.mockResolvedValueOnce(null);

    const c = containerWithBg();
    applyShaderFill(c, rectNode(), 100, 80);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRasterize).toHaveBeenCalledTimes(1);

    // Resize arrives mid-retry-window; it must coalesce, not bake concurrently.
    applyShaderFill(c, rectNode(), 300, 90);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRasterize).toHaveBeenCalledTimes(1);

    // Next bake is the follow-up at the NEW size; it succeeds.
    mockRasterize.mockResolvedValueOnce(Texture.WHITE);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    // Exactly 2 rasterize calls total: the stale-size (100x80) retry never ran.
    expect(mockRasterize).toHaveBeenCalledTimes(2);
    expect(mockRasterize).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "waves" }),
      300,
      90,
      undefined,
    );
    const sprite = c.getChildByLabel("shader-fill") as Sprite;
    expect(sprite).toBeTruthy();
    expect(sprite.width).toBe(300);
    expect(sprite.height).toBe(90);
    // Being superseded is not a final failure — no warn.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
