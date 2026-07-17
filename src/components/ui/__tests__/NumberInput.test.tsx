import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NumberInput } from "@/components/ui/PropertyInputs";

afterEach(() => cleanup());

function setup(props: Partial<Parameters<typeof NumberInput>[0]> = {}) {
  const onChange = vi.fn();
  render(<NumberInput label="W" value={10} onChange={onChange} {...props} />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  return { onChange, input };
}

describe("<NumberInput /> draft layer", () => {
  it("does not call onChange while typing; shows the draft", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "120" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("120");
  });

  it("commits exactly once on blur", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(120);
  });

  it("commits exactly once on Enter", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "77" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(77);
  });

  it("reverts on Escape without committing", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("10");
  });

  it("reverts empty input on blur without committing", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("10");
  });

  it("clamps the committed value to min/max", () => {
    const { onChange, input } = setup({ min: 0, max: 100 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("skips the commit when the value did not change (no undo spam)", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("isMixed: empty commit is a no-op, typed value commits", () => {
    const onChange = vi.fn();
    render(<NumberInput label="W" value={10} isMixed onChange={onChange} />);
    const input = screen.getByPlaceholderText("Mixed") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("isMixed: commits even when the typed value equals the displayed value", () => {
    const onChange = vi.fn();
    render(<NumberInput label="W" value={10} isMixed onChange={onChange} />);
    const input = screen.getByPlaceholderText("Mixed") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    // The other nodes in the selection may differ from `value` — must commit.
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("scrub on the label still live-fires onChange", () => {
    const { onChange } = setup();
    const label = screen.getByText("W");
    fireEvent.mouseDown(label, { button: 0, clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 5 });
    expect(onChange).toHaveBeenCalledWith(15);
    fireEvent.mouseUp(window);
  });
});
