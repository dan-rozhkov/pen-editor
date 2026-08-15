import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveApiUrl } from "@/lib/apiBase";

const { loadImageMock } = vi.hoisted(() => ({
  loadImageMock: vi.fn(),
}));

vi.mock("@/pixi/renderers/htmlTexture/foreignObject", () => ({
  loadImage: loadImageMock,
}));

import { preloadRenderAssets } from "@/pixi/renderers/htmlTexture/svgAssets";

describe("preloadRenderAssets", () => {
  beforeEach(() => {
    loadImageMock.mockReset();
  });

  it("retries a remote image through the backend proxy when direct CORS loading fails", async () => {
    const directUrl =
      "https://pub-example.r2.dev/pen-editor/product-photo.jpg";
    const proxiedImage = document.createElement("img");
    loadImageMock
      .mockRejectedValueOnce(new Error("CORS blocked"))
      .mockResolvedValueOnce(proxiedImage);

    const container = document.createElement("div");
    const image = document.createElement("img");
    image.src = directUrl;
    container.append(image);

    const assets = await preloadRenderAssets(container);

    expect(loadImageMock).toHaveBeenNthCalledWith(1, directUrl);
    expect(loadImageMock).toHaveBeenNthCalledWith(
      2,
      resolveApiUrl(`/api/image-proxy?url=${encodeURIComponent(directUrl)}`),
    );
    expect(assets.imageMap.get(directUrl)).toBe(proxiedImage);
  });
});
