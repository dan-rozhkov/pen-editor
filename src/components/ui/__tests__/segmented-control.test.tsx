import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SegmentedControl } from "../segmented-control";
import { Kbd, KbdGroup } from "../kbd";

const OPTIONS = [
  { value: "1", label: "x1" },
  { value: "2", label: "x2" },
  { value: "3", label: "x3" },
] as const;

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<"1" | "2" | "3">("1");
  return (
    <SegmentedControl
      aria-label="Parallel"
      options={OPTIONS}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

afterEach(cleanup);

describe("<SegmentedControl />", () => {
  it("is a named radiogroup with the current value checked", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Parallel" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "x1" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "x2" }).getAttribute("aria-checked")).toBe("false");
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "x3" }));
    expect(onChange).toHaveBeenCalledWith("3");
    expect(screen.getByRole("radio", { name: "x3" }).getAttribute("aria-checked")).toBe("true");
  });

  it("moves selection with the arrow keys", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const first = screen.getByRole("radio", { name: "x1" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("2"));
    expect(screen.getByRole("radio", { name: "x2" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("<Kbd />", () => {
  it("renders keys inside a group", () => {
    const { container } = render(
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>,
    );
    const keys = container.querySelectorAll("kbd[data-slot='kbd']");
    expect([...keys].map((k) => k.textContent)).toEqual(["⌘", "K"]);
    expect(container.querySelector("[data-slot='kbd-group']")).toBeTruthy();
  });
});
