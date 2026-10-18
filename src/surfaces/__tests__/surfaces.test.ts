import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanvasContext } from "@/hooks/useDesignChat";
import { toolHandlers } from "@/lib/toolRegistry";
import { resetStores, seedScene } from "@/test/fixtures";
import { browserSurface } from "../browserSurface";
import { canvasSurface } from "../canvasSurface";
import { getSurface, SURFACES } from "../index";
import { buildCanvasSurfaceContext } from "../canvasContext";
import { canvasMeta, getAvailableSurfaces } from "../meta";
import { sharedTools } from "../sharedTools";

const claimedToolNames = () => [
  ...SURFACES.flatMap((s) => Object.keys(s.tools)),
  ...Object.keys(sharedTools),
];

describe("surface tool split", () => {
  // A tool claimed twice cannot be tested here: composeToolHandlers throws at
  // toolRegistry import.
  it("surfaces plus shared tools cover exactly the toolHandlers keys", () => {
    expect(claimedToolNames().sort()).toEqual(Object.keys(toolHandlers).sort());
  });

  it("every browse_* and QA tool belongs to the browser surface", () => {
    const names = Object.keys(toolHandlers).filter((n) => n.startsWith("browse_") || n.startsWith("qa_"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(Object.keys(browserSurface.tools)).toContain(name);
      expect(Object.keys(canvasSurface.tools)).not.toContain(name);
    }
  });

  it("keeps ask_user surface-independent", () => {
    expect(Object.keys(sharedTools)).toContain("ask_user");
  });

  it("looks surfaces up by id", () => {
    expect(getSurface("canvas")).toBe(canvasSurface);
    expect(getSurface("browser")).toBe(browserSurface);
  });

  it("has no snapshot: the agent reads the browser through browse_snapshot, which is loop-guarded and queued", () => {
    expect(browserSurface).not.toHaveProperty("snapshot");
  });

  it("keeps Views out of the metadata (they are attached in ./views)", () => {
    for (const meta of getAvailableSurfaces()) expect(meta).not.toHaveProperty("View");
  });
});

describe("canvasSurface.buildContext", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("is exactly what buildCanvasContext serializes into canvasContext", () => {
    const expected = JSON.stringify(canvasSurface.buildContext("chat-1"));
    const { canvasContext } = buildCanvasContext("chat-1") as { canvasContext: string };
    expect(canvasContext).toBe(expected);
  });

  it("is byte-identical across calls for identical state", () => {
    expect(JSON.stringify(canvasSurface.buildContext("chat-1"))).toBe(
      JSON.stringify(canvasSurface.buildContext("chat-1")),
    );
  });
});

describe("surface metadata", () => {
  it("is shared with the tool-bearing surfaces", () => {
    expect(canvasSurface.id).toBe(canvasMeta.id);
    expect(canvasSurface.buildContext).toBe(buildCanvasSurfaceContext);
    expect(getAvailableSurfaces().map((m) => m.id)).toEqual(SURFACES.map((x) => x.id));
  });
});

describe("module graph", () => {
  // Each entry point must evaluate on its own: tool modules (createPlugin)
  // reach pluginApi, which imports toolRegistry, which composes the surfaces.
  it.each([
    "@/surfaces",
    "@/surfaces/meta",
    "@/surfaces/views",
    "@/surfaces/effectiveSurface",
    "@/surfaces/canvasSurface",
    "@/surfaces/browserSurface",
    "@/lib/tools/plugins/createPlugin",
    "@/lib/plugins/pluginApi",
    "@/lib/toolRegistry",
  ])("imports %s as the first module", async (entry) => {
    vi.resetModules();
    await expect(import(/* @vite-ignore */ entry)).resolves.toBeDefined();
  });
});
