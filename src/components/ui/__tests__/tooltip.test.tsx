import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipShortcut } from "@/components/ui/tooltip";

describe("TooltipShortcut", () => {
  it("uses a compact single-line key-cap layout", () => {
    render(<TooltipShortcut>R</TooltipShortcut>);

    const shortcut = screen.getByText("R");
    expect(shortcut.getAttribute("data-slot")).toBe("tooltip-shortcut");
    expect(shortcut.className).toContain("h-4");
    expect(shortcut.className).toContain("leading-4");
    expect(shortcut.className).toContain("py-0");
    expect(shortcut.className).not.toContain("py-0.5");
  });
});
