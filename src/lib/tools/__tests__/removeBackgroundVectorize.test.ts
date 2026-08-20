import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";
import { getIssuedImageUrls, resetIssuedImageUrls } from "@/lib/tools/generateImage/registry";
import { removeBackground } from "@/lib/tools/removeBackground";
import { vectorizeImage } from "@/lib/tools/vectorizeImage";
import { stubSvgGetBBox } from "@/test/svgGetBBoxStub";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function seedImageFillOnRect1(url: string) {
  useSceneStore.getState().updateNode("rect1", {
    fills: [createImagePaint({ url, mode: "fill" })],
    ...clearLegacyFillProps(),
  });
}

beforeEach(() => {
  resetStores();
  seedScene();
  resetIssuedImageUrls();
  stubSvgGetBBox();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("remove_background tool handler", () => {
  it("returns the result as JSON and records the issued url", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ url: "https://cdn/after.png" })));

    const raw = await removeBackground({ node_id: "rect1" });
    const result = JSON.parse(raw);
    expect(result).toEqual({ url: "https://cdn/after.png" });
    expect(getIssuedImageUrls()).toEqual(["https://cdn/after.png"]);
  });

  it("returns a JSON error instead of throwing", async () => {
    const raw = await removeBackground({ node_id: "nope" });
    const result = JSON.parse(raw);
    expect(result.error).toBeTruthy();
  });

  it("errors when neither node_id nor image_url is given", async () => {
    const raw = await removeBackground({});
    const result = JSON.parse(raw);
    expect(result.error).toMatch(/node_id|image_url/);
  });
});

describe("vectorize_image tool handler", () => {
  it("defaults to mode image and returns the result as JSON", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg })),
    );

    const raw = await vectorizeImage({ node_id: "rect1" });
    const result = JSON.parse(raw);
    expect(result.url).toBe("https://cdn/vector.svg");
    // mode "image": the source node still exists, just with a swapped fill.
    expect(useSceneStore.getState().nodesById["rect1"]).toBeTruthy();
  });

  it("adds a model-facing note when the result is too complex to insert", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const rects = Array.from(
      { length: 601 },
      (_, i) => `<rect x="${i}" y="0" width="1" height="1" fill="#000"/>`,
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="10" viewBox="0 0 1000 10">${rects}</svg>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg })),
    );

    const raw = await vectorizeImage({ node_id: "rect1", mode: "layers" });
    const result = JSON.parse(raw);
    expect(result.tooComplex).toBe(true);
    expect(result.note).toMatch(/not.*inserted|inserted/i);
    expect(result.note).toMatch(/mode: "image"/);
  });

  it("adds a model-facing note when shapes were dropped from the source SVG", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const rects = Array.from(
      { length: 20 },
      (_, i) => `<rect x="${i}" y="0" width="1" height="1"${i < 10 ? ' fill="#000"' : ""}/>`,
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10">${rects}</svg>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg })),
    );

    const raw = await vectorizeImage({ node_id: "rect1", mode: "layers" });
    const result = JSON.parse(raw);
    expect(result.droppedShapes).toBe(10);
    expect(result.note).toMatch(/dropped/i);
  });

  it("returns a JSON error instead of throwing", async () => {
    const raw = await vectorizeImage({ node_id: "nope" });
    const result = JSON.parse(raw);
    expect(result.error).toBeTruthy();
  });
});
