import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TypographySection } from "../TypographySection";
import { useTextStyleStore } from "@/store/textStyleStore";
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

afterEach(() => {
  useTextStyleStore.getState().setTextStyles([]);
  cleanup();
});

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

  it("renders and edits Paragraph Spacing", () => {
    const onUpdate = vi.fn();
    render(
      <TypographySection node={textNode({ paragraphSpacing: 8 })} onUpdate={onUpdate} />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // font size, line height, letter spacing, paragraph spacing.
    expect(inputs[3].value).toBe("8");

    fireEvent.change(inputs[3], { target: { value: "16" } });
    expect(onUpdate).toHaveBeenCalledWith({ paragraphSpacing: 16 });
  });

  describe("variable font axes", () => {
    it("hides axis sliders and shows the static weight dropdown for a non-variable font", () => {
      render(<TypographySection node={textNode({ fontFamily: "Arial" })} onUpdate={vi.fn()} />);
      expect(screen.queryAllByRole("slider")).toHaveLength(0);
      expect(screen.getByText("Normal")).toBeDefined();
    });

    it("shows a weight axis slider and hides the static weight dropdown for a variable font", () => {
      render(<TypographySection node={textNode({ fontFamily: "Inter" })} onUpdate={vi.fn()} />);
      expect(screen.getAllByRole("slider")).toHaveLength(1);
      expect(screen.getByText("Weight")).toBeDefined();
      expect(screen.queryByText("Normal")).toBeNull();
    });

    it("shows one slider per registered axis for a multi-axis variable font", () => {
      render(<TypographySection node={textNode({ fontFamily: "Roboto Flex" })} onUpdate={vi.fn()} />);
      expect(screen.getAllByRole("slider")).toHaveLength(4); // wght, wdth, opsz, slnt
      expect(screen.getByText("Weight")).toBeDefined();
      expect(screen.getByText("Width")).toBeDefined();
      expect(screen.getByText("Optical Size")).toBeDefined();
      expect(screen.getByText("Slant")).toBeDefined();
    });

    it("emits onUpdate with the merged fontVariations map when an axis slider changes", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ fontFamily: "Inter", fontVariations: { wght: 400 } })}
          onUpdate={onUpdate}
        />,
      );
      const slider = screen.getByRole("slider", { name: "Weight" });
      // Base UI's Slider Thumb reads `event.target` off a global `event`
      // during its native `change` handler — jsdom's `fireEvent.change`
      // doesn't set that global itself, so it must be stubbed for the
      // duration of the dispatch (same workaround as ImageFillSection's
      // slider test).
      const previousEvent = (globalThis as { event?: Event }).event;
      Object.defineProperty(globalThis, "event", { configurable: true, value: new Event("change") });
      fireEvent.change(slider, { target: { value: "530" } });
      if (previousEvent) {
        Object.defineProperty(globalThis, "event", { configurable: true, value: previousEvent });
      } else {
        delete (globalThis as { event?: Event }).event;
      }

      expect(onUpdate).toHaveBeenCalledWith({ fontVariations: { wght: 530 } });
    });
  });

  describe("resizing mode (setTextWidthMode)", () => {
    it("sets the width mode without touching sizing when nothing fills", () => {
      const onUpdate = vi.fn();
      render(<TypographySection node={textNode({ textWidthMode: "fixed" })} onUpdate={onUpdate} />);
      const auto = screen.getByRole("button", { name: "Auto width" });
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
      const auto = screen.getByRole("button", { name: "Auto width" });
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
      const fixed = screen.getByRole("button", { name: "Fixed width" });
      fireEvent.click(fixed);
      expect(onUpdate).toHaveBeenCalledWith({
        textWidthMode: "fixed",
        sizing: { heightMode: "fit_content" },
      });
    });
  });

  describe("truncation controls", () => {
    const truncateButton = () =>
      screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-label") === "Truncate with ellipsis");

    it("hides the controls in auto-width mode", () => {
      render(
        <TypographySection node={textNode({ textWidthMode: "auto" })} onUpdate={vi.fn()} />,
      );
      expect(truncateButton()).toBeUndefined();
    });

    it("shows and toggles Truncate text in wrapped modes", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textWidthMode: "fixed-height" })}
          onUpdate={onUpdate}
        />,
      );
      const btn = truncateButton();
      expect(btn).toBeDefined();
      fireEvent.click(btn!);
      expect(onUpdate).toHaveBeenCalledWith({ truncateText: true });
    });

    it("clears Truncate text from the dash button", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textWidthMode: "fixed", truncateText: true })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "No truncation" }));
      expect(onUpdate).toHaveBeenCalledWith({ truncateText: false });
    });

    // Locate the Max Lines input via its label (labelOutside layout: the input
    // is a sibling within the same wrapper).
    const maxLinesInput = () =>
      screen.getByText("Max Lines").parentElement!.querySelector("input")!;

    it("writes a positive Max Lines", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection node={textNode({ textWidthMode: "fixed" })} onUpdate={onUpdate} />,
      );
      fireEvent.change(maxLinesInput(), { target: { value: "3" } });
      expect(onUpdate).toHaveBeenCalledWith({ maxLines: 3 });
    });

    it("clears Max Lines (no limit) when set to 0", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textWidthMode: "fixed", maxLines: 3 })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.change(maxLinesInput(), { target: { value: "0" } });
      expect(onUpdate).toHaveBeenCalledWith({ maxLines: undefined });
    });
  });

  describe("text style binding", () => {
    it("opens text styles from the Typography header and does not tag overrides on plain edits", () => {
      const onUpdate = vi.fn();
      render(<TypographySection node={textNode()} onUpdate={onUpdate} />);
      expect(screen.queryByText("No text style")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Text styles" }));
      expect(screen.getByText("Text styles")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Create text style" })).toBeTruthy();

      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[0], { target: { value: "24" } });
      expect(onUpdate).toHaveBeenCalledWith({ fontSize: 24 });
    });

    it("records the edited property in textStyleOverrides when bound to a style", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textStyleId: "style-1" })}
          onUpdate={onUpdate}
        />,
      );
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[0], { target: { value: "24" } }); // font size

      expect(onUpdate).toHaveBeenCalledWith({
        fontSize: 24,
        textStyleOverrides: ["fontSize"],
      });
    });

    it("appends to existing overrides without duplicating them", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({
            textStyleId: "style-1",
            textStyleOverrides: ["fontSize"],
          })}
          onUpdate={onUpdate}
        />,
      );
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[0], { target: { value: "24" } }); // font size again
      expect(onUpdate).toHaveBeenCalledWith({
        fontSize: 24,
        textStyleOverrides: ["fontSize"],
      });

      fireEvent.change(inputs[2], { target: { value: "3" } }); // letter spacing
      expect(onUpdate).toHaveBeenCalledWith({
        letterSpacing: 3,
        textStyleOverrides: ["fontSize", "letterSpacing"],
      });
    });

    it("does not tag non-style properties (e.g. resize mode) as an override", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ textStyleId: "style-1", textWidthMode: "fixed" })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Auto width" }));
      expect(onUpdate).toHaveBeenCalledWith({ textWidthMode: "auto" });
    });

    it("shows a Detach button only when bound to a style", () => {
      const onUpdate = vi.fn();
      const { rerender } = render(
        <TypographySection node={textNode()} onUpdate={onUpdate} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Text styles" }));
      expect(screen.queryByText("Detach from style")).toBeNull();
      expect(screen.queryByRole("button", { name: "Detach from style" })).toBeNull();

      rerender(
        <TypographySection
          node={textNode({ textStyleId: "style-1" })}
          onUpdate={onUpdate}
        />,
      );
      expect(screen.getByRole("button", { name: "Detach from style" })).toBeTruthy();
    });

    it("renames a text style inline from the popover", () => {
      useTextStyleStore.getState().setTextStyles([
        {
          id: "style-1",
          name: "New text style",
          fontFamily: "Arial",
          fontSize: 14,
        },
      ]);
      render(
        <TypographySection
          node={textNode({ textStyleId: "style-1" })}
          onUpdate={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Text styles" }));
      fireEvent.doubleClick(screen.getByText("New text style"));
      const input = screen.getByDisplayValue("New text style");
      fireEvent.change(input, { target: { value: "Body / Medium" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(useTextStyleStore.getState().textStyles[0].name).toBe("Body / Medium");
    });
  });

  it("toggles italic on and off based on current state", () => {
    const italicButton = () => screen.getByRole("button", { name: "Italic" });

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

  describe("list controls", () => {
    it("turns bullet on for every paragraph of a multi-line node", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection node={textNode({ text: "one\ntwo" })} onUpdate={onUpdate} />,
      );
      fireEvent.click(screen.getByLabelText("Bulleted list"));
      expect(onUpdate).toHaveBeenCalledWith({
        paragraphs: [
          { listType: "bullet", indentLevel: 0 },
          { listType: "bullet", indentLevel: 0 },
        ],
      });
    });

    it("turns bullet off (toggle) when already applied to every paragraph", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ text: "one", paragraphs: [{ listType: "bullet" }] })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByLabelText("Bulleted list"));
      expect(onUpdate).toHaveBeenCalledWith({ paragraphs: [{ listType: "none" }] });
    });

    it("switches from bullet to numbered", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ text: "one", paragraphs: [{ listType: "bullet" }] })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByLabelText("Numbered list"));
      expect(onUpdate).toHaveBeenCalledWith({
        paragraphs: [{ listType: "number", indentLevel: 0 }],
      });
    });

    it("indent/outdent buttons change every paragraph's indent level", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ text: "one\ntwo", paragraphs: [{ listType: "bullet" }, { listType: "bullet" }] })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByLabelText("Indent"));
      expect(onUpdate).toHaveBeenCalledWith({
        paragraphs: [
          { listType: "bullet", indentLevel: 1 },
          { listType: "bullet", indentLevel: 1 },
        ],
      });

      onUpdate.mockClear();
      fireEvent.click(screen.getByLabelText("Outdent"));
      expect(onUpdate).toHaveBeenCalledWith({
        paragraphs: [
          { listType: "bullet", indentLevel: 0 },
          { listType: "bullet", indentLevel: 0 },
        ],
      });
    });

    it("indents every paragraph independently (mixed starting levels, clamped at the max), not cumulatively (finding 7c)", () => {
      const onUpdate = vi.fn();
      const text = ["a", "b", "c", "d"].join("\n");
      render(
        <TypographySection
          node={textNode({
            text,
            paragraphs: [
              { listType: "bullet", indentLevel: 0 },
              { listType: "bullet", indentLevel: 3 },
              { listType: "number", indentLevel: 8 }, // already at MAX_INDENT_LEVEL
              {},
            ],
          })}
          onUpdate={onUpdate}
        />,
      );

      fireEvent.click(screen.getByLabelText("Indent"));

      // Each paragraph shifts by exactly one level from its own starting
      // level (not accumulating extra levels from re-processing earlier
      // entries), and the already-maxed paragraph stays clamped.
      expect(onUpdate).toHaveBeenCalledWith({
        paragraphs: [
          { listType: "bullet", indentLevel: 1 },
          { listType: "bullet", indentLevel: 4 },
          { listType: "number", indentLevel: 8 },
          { indentLevel: 1 },
        ],
      });
    });
  });

  describe("link panel", () => {
    afterEach(() => {
      // Some tests leave a global capture-phase keydown listener registered
      // (from the Cmd/Ctrl+K binding) — cleanup() unmounts the component,
      // whose effect teardown removes it, but be explicit in case a test
      // fails before unmount.
      cleanup();
    });

    it("opens the Link popover when clicking the Link button and adds a link", () => {
      const onUpdate = vi.fn();
      render(<TypographySection node={textNode()} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByRole("button", { name: "Link" }));
      const input = screen.getByPlaceholderText("Paste a URL") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "https://example.com" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onUpdate).toHaveBeenCalledWith({ link: { url: "https://example.com" } });
    });

    it("shows a Remove link button only once a link exists, and it clears the link", () => {
      const onUpdate = vi.fn();
      const { rerender } = render(
        <TypographySection node={textNode()} onUpdate={onUpdate} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
      expect(screen.queryByText("Remove link")).toBeNull();

      rerender(
        <TypographySection
          node={textNode({ link: { url: "https://example.com" } })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByText("Remove link"));
      expect(onUpdate).toHaveBeenCalledWith({ link: undefined });
    });

    it("trims the URL and treats a blank submission as removing the link", () => {
      const onUpdate = vi.fn();
      render(
        <TypographySection
          node={textNode({ link: { url: "https://example.com" } })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
      const input = screen.getByPlaceholderText("Paste a URL") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onUpdate).toHaveBeenCalledWith({ link: undefined });
    });

    it("Cmd+K opens the Link panel when focus is on the canvas (not another input)", () => {
      const onUpdate = vi.fn();
      render(<TypographySection node={textNode()} onUpdate={onUpdate} />);
      expect(screen.queryByPlaceholderText("Paste a URL")).toBeNull();

      fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true });

      expect(screen.getByPlaceholderText("Paste a URL")).toBeTruthy();
    });

    it("Cmd+K does not open the Link panel while typing in an unrelated input", () => {
      const onUpdate = vi.fn();
      render(
        <div>
          <input aria-label="unrelated" />
          <TypographySection node={textNode()} onUpdate={onUpdate} />
        </div>,
      );
      const unrelated = screen.getByLabelText("unrelated");
      unrelated.focus();

      fireEvent.keyDown(unrelated, { key: "k", code: "KeyK", metaKey: true });

      expect(screen.queryByPlaceholderText("Paste a URL")).toBeNull();
    });
  });
});
