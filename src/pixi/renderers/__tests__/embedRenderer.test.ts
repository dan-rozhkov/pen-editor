import { describe, it, expect } from "vitest";
import { Sprite } from "pixi.js";
import { createEmbedContainer, updateEmbedContainer } from "../embedRenderer";
import type { EmbedNode } from "@/types/scene";

const embed = (html: string): EmbedNode =>
  ({ id: "e1", type: "embed", name: "Code", x: 0, y: 0, width: 100, height: 80, htmlContent: html } as unknown as EmbedNode);

describe("embedRenderer (DOM-overlay era)", () => {
  it("creates an empty container with no texture sprite", () => {
    const c = createEmbedContainer(embed("<p>hi</p>"));
    expect(c.children.some((ch) => ch instanceof Sprite)).toBe(false);
  });

  it("update does not add a texture sprite", () => {
    const c = createEmbedContainer(embed("<p>a</p>"));
    updateEmbedContainer(c, embed("<p>b</p>"), embed("<p>a</p>"));
    expect(c.children.some((ch) => ch instanceof Sprite)).toBe(false);
  });
});
