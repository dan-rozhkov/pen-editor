import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EmbedSlideThumbnail } from "../EmbedSlideThumbnail";
import { resetStores } from "@/test/fixtures";
import { editorVariablesEmbedNode as node, seedVariable } from "./editorVariablesFixtures";

// F5 regression: EmbedSlideThumbnail (the Slides panel preview) mounts an
// embed's raw htmlContent via mountHtmlWithBodyStyles but historically never
// called applyEditorVariableProperties afterwards — unlike EmbedLayer.tsx,
// which applies the same editor variable values to the live canvas overlay.
// An element bound to an editor variable (`var(--brand)`) therefore had
// nothing to resolve that custom property against in this thumbnail's own
// shadow tree specifically, even though the live canvas resolved it fine.

describe("<EmbedSlideThumbnail /> editor variables", () => {
  beforeEach(() => { resetStores(); });
  afterEach(() => cleanup());

  it("applies editor variable values to the mounted preview root", () => {
    seedVariable();
    const { container } = render(<EmbedSlideThumbnail node={node} />);
    const host = container.querySelector<HTMLElement>(
      `[data-testid="embed-slide-thumbnail-${node.id}"]`,
    )!;
    const root = host.shadowRoot!.firstElementChild as HTMLElement;

    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");
  });

  it("leaves the property unset when no editor variable supplies it", () => {
    const { container } = render(<EmbedSlideThumbnail node={node} />);
    const host = container.querySelector<HTMLElement>(
      `[data-testid="embed-slide-thumbnail-${node.id}"]`,
    )!;
    const root = host.shadowRoot!.firstElementChild as HTMLElement;

    expect(root.style.getPropertyValue("--brand")).toBe("");
  });
});
