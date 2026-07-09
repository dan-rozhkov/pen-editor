import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AutoLayoutSection } from "../AutoLayoutSection";
import type { FrameNode } from "@/types/scene";

function frame(layout?: Record<string, unknown>): FrameNode {
  return {
    id: "f1",
    type: "frame",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ...(layout ? { layout } : {}),
  } as FrameNode;
}

afterEach(() => cleanup());

describe("<AutoLayoutSection />", () => {
  it("enables auto layout (and hugs height) from the collapsed state", () => {
    const onUpdate = vi.fn();
    render(<AutoLayoutSection node={frame()} onUpdate={onUpdate} />);
    // collapsed -> the only button is the "+" action
    fireEvent.click(screen.getByRole("button"));
    expect(onUpdate).toHaveBeenCalledWith({
      layout: { autoLayout: true },
      sizing: { heightMode: "fit_content" },
    });
  });

  it("disables auto layout via the action button", () => {
    const onUpdate = vi.fn();
    render(
      <AutoLayoutSection
        node={frame({ autoLayout: true, flexDirection: "row" })}
        onUpdate={onUpdate}
      />,
    );
    // the action (minus) button is the only button without a title; the 9
    // alignment-grid buttons all have titles.
    const action = screen.getAllByRole("button").find((b) => !b.getAttribute("title"));
    fireEvent.click(action!);
    expect(onUpdate).toHaveBeenCalledWith({
      layout: { autoLayout: false, flexDirection: "row" },
    });
  });

  it("renders gap and padding values when expanded", () => {
    render(
      <AutoLayoutSection
        node={frame({
          autoLayout: true,
          flexDirection: "row",
          gap: 8,
          paddingTop: 4,
          paddingRight: 5,
          paddingBottom: 6,
          paddingLeft: 7,
        })}
        onUpdate={vi.fn()}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // DOM order: Gap, T, R, B, L
    expect(inputs.map((i) => i.value)).toEqual(["8", "4", "5", "6", "7"]);
  });

  it("updates gap and padding via their inputs", () => {
    const onUpdate = vi.fn();
    render(
      <AutoLayoutSection
        node={frame({ autoLayout: true, flexDirection: "row", gap: 0 })}
        onUpdate={onUpdate}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton");

    fireEvent.change(inputs[0], { target: { value: "16" } });
    expect(onUpdate).toHaveBeenCalledWith({
      layout: expect.objectContaining({ gap: 16 }),
    });

    fireEvent.change(inputs[1], { target: { value: "12" } });
    expect(onUpdate).toHaveBeenCalledWith({
      layout: expect.objectContaining({ paddingTop: 12 }),
    });
  });

  it("accepts a negative gap value (overlap) with no min clamp on the input", () => {
    const onUpdate = vi.fn();
    render(
      <AutoLayoutSection
        node={frame({ autoLayout: true, flexDirection: "row", gap: 0 })}
        onUpdate={onUpdate}
      />,
    );
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const gapInput = inputs[0];

    // The gap input must not carry a `min` attribute — that's what would
    // block negative entry (either via the browser's native validation or
    // the scrub-drag/steppers, both of which read the `min` prop).
    expect(gapInput.hasAttribute("min")).toBe(false);

    fireEvent.change(gapInput, { target: { value: "-10" } });
    expect(onUpdate).toHaveBeenCalledWith({
      layout: expect.objectContaining({ gap: -10 }),
    });
  });

  describe("wrap", () => {
    it("toggles flexWrap via the checkbox", () => {
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({ autoLayout: true, flexDirection: "row" })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByLabelText("Wrap"));
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({ flexWrap: true }),
      });
    });

    it("shows separate row/column gap inputs instead of a single Gap when wrapping", () => {
      render(
        <AutoLayoutSection
          node={frame({
            autoLayout: true,
            flexDirection: "row",
            flexWrap: true,
            rowGap: 10,
            columnGap: 5,
          })}
          onUpdate={vi.fn()}
        />,
      );
      expect(screen.getByText("Row gap")).toBeTruthy();
      expect(screen.getByText("Column gap")).toBeTruthy();
      expect(screen.queryByText("Gap")).toBeNull();
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      // DOM order: Row gap, Column gap, T, R, B, L
      expect(inputs.map((i) => i.value)).toEqual(["10", "5", "0", "0", "0", "0"]);
    });

    it("falls back to gap for row/column gap display when unset", () => {
      render(
        <AutoLayoutSection
          node={frame({
            autoLayout: true,
            flexDirection: "row",
            flexWrap: true,
            gap: 12,
          })}
          onUpdate={vi.fn()}
        />,
      );
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(inputs[0].value).toBe("12"); // row gap falls back to gap
      expect(inputs[1].value).toBe("12"); // column gap falls back to gap
    });

    it("migrates the main-axis gap into `gap` and clears rowGap/columnGap when wrap is turned off", () => {
      // Row direction: the main axis is horizontal, so its gap is
      // columnGap (falling back to gap). Disabling wrap must migrate that
      // value into `gap` and clear the per-axis fields — otherwise the
      // plain "Gap" input (which only ever writes `layout.gap`) would have
      // no visible effect, since mainGap = columnGap ?? gap would still
      // read the stale columnGap.
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({
            autoLayout: true,
            flexDirection: "row",
            flexWrap: true,
            rowGap: 10,
            columnGap: 5,
          })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByLabelText("Wrap"));
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          flexWrap: false,
          gap: 5,
          rowGap: undefined,
          columnGap: undefined,
        }),
      });
    });

    it("migrates the main-axis (rowGap) value for a column direction when wrap is turned off", () => {
      // Column direction: the main axis is vertical, so its gap is rowGap.
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({
            autoLayout: true,
            flexDirection: "column",
            flexWrap: true,
            rowGap: 10,
            columnGap: 5,
          })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByLabelText("Wrap"));
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          flexWrap: false,
          gap: 10,
          rowGap: undefined,
          columnGap: undefined,
        }),
      });
    });

    it("updates rowGap/columnGap independently via their inputs", () => {
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({
            autoLayout: true,
            flexDirection: "row",
            flexWrap: true,
            rowGap: 10,
            columnGap: 5,
          })}
          onUpdate={onUpdate}
        />,
      );
      const inputs = screen.getAllByRole("spinbutton");
      fireEvent.change(inputs[0], { target: { value: "20" } });
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({ rowGap: 20 }),
      });
      fireEvent.change(inputs[1], { target: { value: "7" } });
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({ columnGap: 7 }),
      });
    });
  });

  describe("alignment grid", () => {
    it("sets alignItems/justifyContent on a grid cell click (row direction)", () => {
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({ autoLayout: true, flexDirection: "row" })}
          onUpdate={onUpdate}
        />,
      );
      // top-left cell: justify flex-start, align flex-start
      fireEvent.click(screen.getByTitle("H: flex-start, V: flex-start"));
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          alignItems: "flex-start",
          justifyContent: "flex-start",
        }),
      });
    });

    it("centers via the middle cell", () => {
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({ autoLayout: true, flexDirection: "row" })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.click(screen.getByTitle(/H: center, V: center/));
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          alignItems: "center",
          justifyContent: "center",
        }),
      });
    });

    it("toggles space-between on double-clicking a center-column cell", () => {
      const onUpdate = vi.fn();
      render(
        <AutoLayoutSection
          node={frame({ autoLayout: true, flexDirection: "row", justifyContent: "center" })}
          onUpdate={onUpdate}
        />,
      );
      fireEvent.doubleClick(screen.getByTitle(/H: center, V: center/));
      expect(onUpdate).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          alignItems: "center",
          justifyContent: "space-between",
        }),
      });
    });
  });
});
