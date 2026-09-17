import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EmbedSlideThumbnail } from "../EmbedSlideThumbnail";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import type { EmbedNode } from "@/types/scene";
import type { Variable } from "@/types/variable";

// F5 regression: EmbedSlideThumbnail (the Slides panel preview) mounts an
// embed's raw htmlContent via mountHtmlWithBodyStyles but historically never
// called applyEditorVariableProperties afterwards — unlike EmbedLayer.tsx,
// which applies the same editor variable values to the live canvas overlay.
// An element bound to an editor variable (`var(--brand)`) therefore had
// nothing to resolve that custom property against in this thumbnail's own
// shadow tree specifically, even though the live canvas resolved it fine.

function seedVariable(): void {
  useVariableStore.setState({
    variables: [
      {
        id: "v1",
        name: "--brand",
        type: "color",
        value: "#00ff00",
        themeValues: { light: "#00ff00", dark: "#003300" },
      } as unknown as Variable,
    ],
  });
}

const node = {
  id: "e1",
  type: "embed",
  name: "Code",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  htmlContent: "<div id='card' style='background-color: var(--brand)'>hi</div>",
} as unknown as EmbedNode;

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
