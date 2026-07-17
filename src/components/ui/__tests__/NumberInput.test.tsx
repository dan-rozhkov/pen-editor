import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NumberInput } from "@/components/ui/PropertyInputs";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";

beforeEach(() => resetStores());
afterEach(() => cleanup());

function setup(props: Partial<Parameters<typeof NumberInput>[0]> = {}) {
  const onChange = vi.fn();
  render(<NumberInput label="W" value={10} onChange={onChange} {...props} />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  return { onChange, input };
}

describe("<NumberInput /> live commit", () => {
  it("commits every parseable keystroke so the canvas tracks typing", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "120" } });
    expect(onChange.mock.calls).toEqual([[12], [120]]);
  });

  it("shows the typed text verbatim while committing live", () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "120" } });
    expect(input.value).toBe("120");
  });

  // "1." is deliberately absent: parseFloat("1.") === 1, and committing 1 while
  // the user is on their way to "1.5" is correct live behavior.
  it.each(["", "-"])("does not commit the unparseable draft %j", (draft) => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: draft } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps each live commit to min/max", () => {
    const { onChange, input } = setup({ min: 0, max: 100 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith(100);
  });

  // Read-only is covered against the real ReadOnlyProvider in
  // PropertyInputs.readonly.test.tsx — setting input.readOnly here would not
  // exercise the component's useReadOnly() guard at all.

  it("scrub on the label still live-fires onChange", () => {
    const { onChange } = setup();
    const label = screen.getByText("W");
    fireEvent.mouseDown(label, { button: 0, clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 5 });
    expect(onChange).toHaveBeenCalledWith(15);
    fireEvent.mouseUp(window);
  });

  it("isMixed: commits even when the typed value equals the displayed value", () => {
    const onChange = vi.fn();
    render(<NumberInput label="W" value={10} isMixed onChange={onChange} />);
    const input = screen.getByPlaceholderText("Mixed") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "10" } });
    // The other nodes in the selection may differ from `value` — must commit.
    expect(onChange).toHaveBeenCalledWith(10);
  });
});

describe("<NumberInput /> undo grouping", () => {
  it("collapses a whole editing session into one undo entry", () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "120" } });
    expect(useHistoryStore.getState().batchMode).toBe(true);
    fireEvent.blur(input);
    expect(useHistoryStore.getState().batchMode).toBe(false);
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("touches history only once the first real commit lands", () => {
    const { input } = setup();
    fireEvent.focus(input);
    expect(useHistoryStore.getState().past).toHaveLength(0);
    fireEvent.change(input, { target: { value: "-" } });
    expect(useHistoryStore.getState().past).toHaveLength(0);
    fireEvent.blur(input);
    expect(useHistoryStore.getState().past).toHaveLength(0);
    expect(useHistoryStore.getState().batchMode).toBe(false);
  });

  it("ends the batch on Enter", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "77" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(77);
    expect(useHistoryStore.getState().batchMode).toBe(false);
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });
});

describe("<NumberInput /> unmounted mid-edit", () => {
  // Escape is handled by a window listener registered with { capture: true }
  // (useCanvasKeyboardShortcuts): it clears the selection and unmounts this
  // input before the input's own keydown/blur handlers ever run. An open
  // batch that outlives the component leaves batchDepth stuck above 0, which
  // silently suppresses ALL history recording for the rest of the session.
  it("closes its history batch when it unmounts without a blur", () => {
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });
    expect(useHistoryStore.getState().batchMode).toBe(true);
    cleanup();
    expect(useHistoryStore.getState().batchMode).toBe(false);
    expect(useHistoryStore.getState().batchDepth).toBe(0);
  });
});
