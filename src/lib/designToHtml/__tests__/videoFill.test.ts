import { describe, it, expect } from "vitest";
import { generateVideoFillHtml, generateVisualStyles } from "../styleGeneration";
import { convertNodeToHtml, type ConversionContext } from "../convertNode";
import type { FlatSceneNode, Paint, RectNode, VideoFill } from "@/types/scene";

function videoPaint(video: Partial<VideoFill> = {}): Paint {
  return {
    id: "vp1",
    type: "video",
    video: {
      src: "https://cdn.example.com/clip.mp4",
      mode: "fill",
      playback: { autoplay: true, loop: true, muted: true },
      ...video,
    },
  };
}

function rect(extra: Partial<RectNode>): RectNode {
  return { id: "r1", type: "rect", x: 0, y: 0, width: 100, height: 100, ...extra };
}

function makeCtx(nodesById: Record<string, FlatSceneNode>): ConversionContext {
  return { nodesById, childrenById: {}, allNodes: [] };
}

describe("designToHtml video fill", () => {
  it("emits a <video> element with src, object-fit, and playback attributes", () => {
    const html = generateVideoFillHtml(rect({ fills: [videoPaint()] }));
    expect(html).toContain("<video ");
    expect(html).toContain('src="https://cdn.example.com/clip.mp4"');
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("autoplay");
    expect(html).toContain("loop");
    expect(html).toContain("muted");
    expect(html).toContain("playsinline");
    expect(html).toContain("border-radius:inherit");
  });

  it("exports the topmost video paint when a node stacks several (matches the canvas)", () => {
    // `fills` is bottom-to-top, so the last video paint renders on top.
    const html = generateVideoFillHtml(
      rect({
        fills: [
          videoPaint({ src: "https://cdn.example.com/bottom.mp4" }),
          videoPaint({ src: "https://cdn.example.com/top.mp4" }),
        ],
      }),
    );
    expect(html).toContain('src="https://cdn.example.com/top.mp4"');
    expect(html).not.toContain("bottom.mp4");
  });

  it("maps fit → contain and stretch → fill for object-fit", () => {
    expect(generateVideoFillHtml(rect({ fills: [videoPaint({ mode: "fit" })] }))).toContain(
      "object-fit:contain",
    );
    expect(generateVideoFillHtml(rect({ fills: [videoPaint({ mode: "stretch" })] }))).toContain(
      "object-fit:fill",
    );
  });

  it("forces muted when autoplay is on even if muted is false (browser autoplay policy)", () => {
    const html = generateVideoFillHtml(
      rect({ fills: [videoPaint({ playback: { autoplay: true, loop: false, muted: false } })] }),
    );
    expect(html).toContain("autoplay");
    expect(html).toContain("muted");
    expect(html).not.toContain("loop");
  });

  it("omits autoplay/loop when disabled and keeps an unmuted paused video unmuted", () => {
    const html = generateVideoFillHtml(
      rect({ fills: [videoPaint({ playback: { autoplay: false, loop: false, muted: false } })] }),
    );
    expect(html).not.toContain("autoplay");
    expect(html).not.toContain("loop");
    expect(html).not.toContain(" muted");
    expect(html).toContain("playsinline");
  });

  it("emits a clip-path inset() matching the crop rect", () => {
    const html = generateVideoFillHtml(
      rect({ fills: [videoPaint({ crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } })] }),
    );
    // top=20% right=40% bottom=20% left=10%
    expect(html).toContain("clip-path:inset(20% 40% 20% 10%)");
  });

  it("returns '' for a node with no video fill", () => {
    expect(generateVideoFillHtml(rect({ fills: [{ id: "s", type: "solid", color: "#fff" }] }))).toBe("");
    expect(generateVideoFillHtml(rect({ fills: [videoPaint({ src: "" })] }))).toBe("");
  });

  it("does not emit a background-image for a video paint (rendered as an element)", () => {
    const styles = generateVisualStyles(rect({ fills: [videoPaint()] }));
    expect(styles["background-image"]).toBeUndefined();
  });

  it("injects the <video> element into a rect node's div with a positioning context", () => {
    const node = rect({ fills: [videoPaint()] });
    const html = convertNodeToHtml("r1", makeCtx({ r1: node as FlatSceneNode }), undefined, true);
    expect(html).toContain("<video ");
    expect(html).toContain("position:relative");
  });
});
