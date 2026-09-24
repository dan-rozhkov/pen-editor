import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { InlineEmbedEditor } from "../InlineEmbedEditor";
import { resetStores } from "@/test/fixtures";
import { editorVariablesEmbedNode as node, seedVariable } from "./editorVariablesFixtures";

// F5 regression: pressing "Edit inline" mounts the embed's raw htmlContent
// into a SEPARATE shadow tree (InlineEmbedEditor, independent from
// EmbedLayer.tsx's own live overlay) but historically never applied editor
// variable values to it. An element bound to a variable (`var(--brand)`)
// therefore rendered with the custom property unresolved for the duration
// of the edit — the fill went transparent even though the underlying canvas
// shows it correctly.

describe("<InlineEmbedEditor /> editor variables", () => {
  beforeEach(() => { resetStores(); });
  afterEach(() => cleanup());

  it("applies editor variable values to the mounted editable root", () => {
    seedVariable();
    const { container } = render(
      <InlineEmbedEditor node={node} absoluteX={0} absoluteY={0} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const root = host.shadowRoot!.querySelector("div")!;

    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");
  });

  it("leaves the property unset when no editor variable supplies it", () => {
    const { container } = render(
      <InlineEmbedEditor node={node} absoluteX={0} absoluteY={0} />,
    );
    const host = container.firstElementChild as HTMLElement;
    const root = host.shadowRoot!.querySelector("div")!;

    expect(root.style.getPropertyValue("--brand")).toBe("");
  });
});
