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
