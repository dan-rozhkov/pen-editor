import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import * as icons from "@/components/icons";
import type { Icon } from "@/components/icons";

afterEach(cleanup);

const glyphs = Object.entries(icons).filter(([name]) => /^[A-Z]\w*Icon$/.test(name)) as [string, Icon][];

// Every glyph the app renders with weight="fill" — each must have a real solid
// variant, or the active/filled state looks identical to the outline.
const FILLED = [
  "AppleLogo", "Camera", "CheckCircle", "Circle", "Flag", "Globe", "Heart", "Info",
  "Keyboard", "Lightbulb", "Megaphone", "Palette", "PuzzlePiece", "Selection",
  "Sparkle", "UserCircle", "Warning", "WarningCircle", "WarningOctagon", "XCircle",
];

describe("icon set", () => {
  it("exports the glyphs", () => {
    expect(glyphs.length).toBeGreaterThan(190);
  });

  it.each(glyphs)("%s renders a named 16-unit glyph in both weights", (exportName, Glyph) => {
    const { container } = render(
      <>
        <Glyph />
        <Glyph weight="fill" />
      </>,
    );
    const [outline, solid] = container.querySelectorAll("svg");
    expect(outline.getAttribute("data-pen-icon")).toBe(exportName.replace(/Icon$/, ""));
    expect(outline.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(outline.children.length).toBeGreaterThan(0);
    expect(solid.children.length).toBeGreaterThan(0);
  });

  it.each(FILLED)("%sIcon has a solid variant", (name) => {
    const Glyph = (icons as unknown as Record<string, Icon>)[`${name}Icon`];
    const { container } = render(<Glyph weight="fill" />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });
});
