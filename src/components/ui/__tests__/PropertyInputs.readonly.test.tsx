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
