import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TextRewriteSection } from "../TextRewriteSection";
import { TEXT_REWRITE_PRESETS } from "@/lib/textRewritePresets";

const mockLaunch = vi.fn();
vi.mock("@/lib/launchTextRewriteChat", () => ({
  launchTextRewriteChat: (...args: unknown[]) => mockLaunch(...args),
}));

afterEach(() => cleanup());
beforeEach(() => mockLaunch.mockReset());

describe("<TextRewriteSection />", () => {
  it("renders a Rewrite trigger with the menu closed initially", () => {
    render(<TextRewriteSection nodeIds={["text1"]} />);
    expect(screen.getByRole("button", { name: /rewrite/i })).toBeTruthy();
    expect(screen.queryByText(TEXT_REWRITE_PRESETS[0].label)).toBeNull();
  });

  it("lists every preset once the menu is opened", () => {
    render(<TextRewriteSection nodeIds={["text1"]} />);
    fireEvent.click(screen.getByRole("button", { name: /rewrite/i }));
    for (const preset of TEXT_REWRITE_PRESETS) {
      expect(screen.getByText(preset.label)).toBeTruthy();
    }
  });

  it("launches a rewrite chat with the selected node ids and preset on click", () => {
    render(<TextRewriteSection nodeIds={["text1", "text2"]} />);
    fireEvent.click(screen.getByRole("button", { name: /rewrite/i }));
    fireEvent.click(screen.getByText(TEXT_REWRITE_PRESETS[0].label));

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith(
      ["text1", "text2"],
      TEXT_REWRITE_PRESETS[0],
    );
  });
});
