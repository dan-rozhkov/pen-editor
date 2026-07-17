import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NumberInput, TextInput, CheckboxInput } from "@/components/ui/PropertyInputs";
import { ReadOnlyProvider } from "@/components/ReadOnlyProvider";

afterEach(() => cleanup());

describe("PropertyInputs in read-only mode", () => {
  it("NumberInput does not fire onChange when read-only", () => {
    const onChange = vi.fn();
    render(
      <ReadOnlyProvider value={true}>
        <NumberInput label="W" value={10} onChange={onChange} />
      </ReadOnlyProvider>,
    );
    const input = screen.getByDisplayValue("10") as HTMLInputElement;
    expect(input.readOnly || input.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "20" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("NumberInput does not commit a clamp of an out-of-range value on Enter when read-only", () => {
    // `value` is deliberately outside [min, max]: on Enter, commitValue would
    // format/clamp it to something that differs from `value`, which is the
    // only scenario where the readOnly guard actually prevents a commit
    // (readOnly + value within range is a no-op even with the guard removed,
    // since next === value). Don't "simplify" this back to an in-range value.
    const onChange = vi.fn();
    render(
      <ReadOnlyProvider value={true}>
        <NumberInput label="W" value={150} min={0} max={100} onChange={onChange} />
      </ReadOnlyProvider>,
    );
    const input = screen.getByDisplayValue("150");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CheckboxInput is disabled when read-only", () => {
    const onChange = vi.fn();
    render(
      <ReadOnlyProvider value={true}>
        <CheckboxInput label="Clip" checked={false} onChange={onChange} />
      </ReadOnlyProvider>,
    );
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inputs remain editable without a provider (default edit mode)", () => {
    const onChange = vi.fn();
    render(<TextInput label="Name" value="a" onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("a"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalled();
  });
});
