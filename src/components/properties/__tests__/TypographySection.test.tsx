import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TypographySection } from "../TypographySection";
import type { TextNode } from "@/types/scene";

// FontCombobox has a debounced search effect that isn't under test here; stub
// it so its timer doesn't emit act() warnings. It renders before every icon
// button, so end-relative button indexing below is unaffected.
vi.mock("@/components/ui/FontCombobox", () => ({
  FontCombobox: () => null,
}));

function textNode(extra: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 120,
    height: 24,
    text: "Hello",
    fontFamily: "Arial",
    fontSize: 16,
    ...extra,
  } as TextNode;
}

afterEach(() => cleanup());

describe("<TypographySection />", () => {
  it("renders font size, line height and letter spacing", () => {
    render(
      <TypographySection
        node={textNode({ fontSize: 18, lineHeight: 1.5, letterSpacing: 2 })}
        onUpdate={vi.fn()}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[0].value).toBe("18"); // font size
    expect(inputs[1].value).toBe("1.5"); // line height
    expect(inputs[2].value).toBe("2"); // letter spacing
  });

  it("emits onUpdate for font size, line height and letter spacing edits", () => {
    const onUpdate = vi.fn();
    render(<TypographySection node={textNode()} onUpdate={onUpdate} />);
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[0], { target: { value: "24" } });
    expect(onUpdate).toHaveBeenCalledWith({ fontSize: 24 });

    fireEvent.change(inputs[1], { target: { value: "1.4" } });
    expect(onUpdate).toHaveBeenCalledWith({ lineHeight: 1.4 });

    fireEvent.change(inputs[2], { target: { value: "3" } });
    expect(onUpdate).toHaveBeenCalledWith({ letterSpacing: 3 });
  });

  describe("resizing mode (setTextWidthMode)", () => {
    // The resizing group is the final ButtonGroup -> last 3 role=button elements
    // are [auto, fixed, fixed-height].
    function resizingButtons() {
      const buttons = screen.getAllByRole("button");
      return buttons.slice(-3);
    }

    it("sets the width mode without touching sizing when nothing fills", () => {
      const onUpdate = vi.fn();
      render(<TypographySection node={textNode({ textWidthMode: "fixed" })} onUpdate={onUpdate} />);
      const [auto] = resizingButtons();
      fireEvent.click(auto);
      expect(onUpdate).toHaveBeenCalledWith({ textWidthMode: "auto" });
    });

    it("demotes a fill_container width to fit_content when switching to auto", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textWidthMode: "fixed", sizing: { widthMode: "fill_container" } })}
          onUpdate={onUpdate}
        />,
      );
      const [auto] = resizingButtons();
      fireEvent.click(auto);
      expect(onUpdate).toHaveBeenCalledWith({
        textWidthMode: "auto",
        sizing: { widthMode: "fit_content" },
      });
    });

    it("demotes a fill_container height to fit_content when switching to fixed", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textWidthMode: "auto", sizing: { heightMode: "fill_container" } })}
          onUpdate={onUpdate}
        />,
      );
      const [, fixed] = resizingButtons();
      fireEvent.click(fixed);
      expect(onUpdate).toHaveBeenCalledWith({
        textWidthMode: "fixed",
        sizing: { heightMode: "fit_content" },
      });
    });
  });

  it("toggles italic on and off based on current state", () => {
    // The icon-only buttons after italic are, in DOM order: underline,
    // strikethrough, align L/C/R, vAlign T/M/B, resize a/f/fh — 11 buttons —
    // so italic is the 12th from the end (stable regardless of leading
    // combobox/select triggers).
    const italicButton = () => screen.getAllByRole("button").slice(-12)[0];

    const onUpdate = vi.fn();
    const { unmount } = render(
      <TypographySection node={textNode({ fontStyle: "normal" })} onUpdate={onUpdate} />,
    );
    fireEvent.click(italicButton());
    expect(onUpdate).toHaveBeenCalledWith({ fontStyle: "italic" });
    unmount();
    onUpdate.mockClear();

    render(<TypographySection node={textNode({ fontStyle: "italic" })} onUpdate={onUpdate} />);
    fireEvent.click(italicButton());
    expect(onUpdate).toHaveBeenCalledWith({ fontStyle: "normal" });
  });
});
