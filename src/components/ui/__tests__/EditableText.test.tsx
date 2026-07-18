import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EditableText } from "@/components/ui/EditableText";

afterEach(() => cleanup());

function setup(props: Partial<Parameters<typeof EditableText>[0]> = {}) {
  const onCommit = vi.fn();
  render(<EditableText value="Hello" onCommit={onCommit} {...props} />);
  return { onCommit };
}

describe("<EditableText />", () => {
  it("click activates edit mode with an input showing the current value", () => {
    setup();
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByText("Hello"));

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it("Enter commits the trimmed value", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByText("Hello"));

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  World  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith("World");
  });

  it("Escape reverts the draft without committing", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByText("Hello"));

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Throwaway" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    // Editing input is gone; display shows the original value.
    expect(screen.queryByDisplayValue("Throwaway")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("blur commits the trimmed value", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByText("Hello"));

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "World" } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith("World");
  });

  it("refuses to commit an empty value by default", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByText("Hello"));

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits an empty value when allowEmpty is set", () => {
    const { onCommit } = setup({ allowEmpty: true });
    fireEvent.click(screen.getByText("Hello"));

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith("");
  });

  it('activateOn="doubleClick" does not enter edit mode on a single click', () => {
    setup({ activateOn: "doubleClick" });

    fireEvent.click(screen.getByText("Hello"));
    expect(screen.queryByDisplayValue("Hello")).toBeNull();

    fireEvent.doubleClick(screen.getByText("Hello"));
    expect(screen.getByDisplayValue("Hello")).toBeTruthy();
  });

  it("calls onEditingChange when entering and exiting edit mode", () => {
    const onEditingChange = vi.fn();
    setup({ onEditingChange });

    fireEvent.click(screen.getByText("Hello"));
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    const input = screen.getByDisplayValue("Hello") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });
});
