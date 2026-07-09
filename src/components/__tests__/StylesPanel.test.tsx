import { beforeEach, describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { StylesDialog } from "@/components/StylesPanel";
import { useStyleStore } from "@/store/styleStore";
import { resetStores } from "@/test/fixtures";

afterEach(() => cleanup());

describe("<StylesDialog />", () => {
  beforeEach(() => {
    resetStores();
  });

  it("lists existing fill and effect styles", () => {
    useStyleStore.setState({
      fillStyles: [{ id: "fs1", name: "Brand/Primary", paint: { id: "p", type: "solid", color: "#3366ff" } }],
      effectStyles: [
        {
          id: "es1",
          name: "Card/Shadow",
          effects: [{ type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 4 }, blur: 8, spread: 0, id: "e" }],
        },
      ],
    });
    render(<StylesDialog open onOpenChange={() => {}} />);
    expect(screen.getByText("Brand/Primary")).toBeTruthy();
    expect(screen.getByText("Card/Shadow")).toBeTruthy();
    expect(screen.getByTestId("styles-list").children).toHaveLength(2);
    expect(screen.queryByText("Fill styles")).toBeNull();
    expect(screen.queryByText("Effect styles")).toBeNull();
  });

  it("adds a fill style from the Add menu", () => {
    render(<StylesDialog open onOpenChange={() => {}} />);
    expect(useStyleStore.getState().fillStyles).toHaveLength(0);
    fireEvent.click(screen.getByTitle("Add style"));
    fireEvent.click(screen.getByText("Fill style"));
    expect(useStyleStore.getState().fillStyles).toHaveLength(1);
  });

  it("adds an effect style from the Add menu", () => {
    render(<StylesDialog open onOpenChange={() => {}} />);
    expect(useStyleStore.getState().effectStyles).toHaveLength(0);
    fireEvent.click(screen.getByTitle("Add style"));
    fireEvent.click(screen.getByText("Effect style"));
    expect(useStyleStore.getState().effectStyles).toHaveLength(1);
    expect(useStyleStore.getState().effectStyles[0].effects).toHaveLength(1);
  });

  it("deleting a fill style removes it from the store", () => {
    useStyleStore.setState({
      fillStyles: [{ id: "fs1", name: "Brand", paint: { id: "p", type: "solid", color: "#3366ff" } }],
      effectStyles: [],
    });
    render(<StylesDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTitle("Delete fill style"));
    expect(useStyleStore.getState().fillStyles).toHaveLength(0);
  });

  it("renaming a fill style commits the new name to the store", () => {
    useStyleStore.setState({
      fillStyles: [{ id: "fs1", name: "Brand", paint: { id: "p", type: "solid", color: "#3366ff" } }],
      effectStyles: [],
    });
    render(<StylesDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByText("Brand"));
    const input = screen.getByDisplayValue("Brand") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Accent" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStyleStore.getState().fillStyles[0].name).toBe("Accent");
  });

  it("keeps the color picker open while switching color formats", () => {
    useStyleStore.setState({
      fillStyles: [{ id: "fs1", name: "Brand", paint: { id: "p", type: "solid", color: "#3366ff" } }],
      effectStyles: [],
    });
    const onOpenChange = vi.fn();
    render(<StylesDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByLabelText("Pick color"));
    const rgbButton = screen.getByRole("button", { name: "RGB" });
    fireEvent.pointerDown(rgbButton);
    fireEvent.click(rgbButton);

    expect(screen.getByLabelText("Red")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false, expect.anything());
  });
});
