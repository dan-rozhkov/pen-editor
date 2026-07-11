import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EmbedAgentButton } from "../EmbedAgentButton";
import type { EmbedNode } from "@/types/scene";

const mockLaunch = vi.fn();
vi.mock("@/lib/launchEmbedAgentChat", () => ({
  launchEmbedAgentChat: (...args: unknown[]) => mockLaunch(...args),
}));

const embed = {
  id: "embed-1",
  type: "embed",
  name: "Card",
  x: 0,
  y: 0,
  width: 320,
  height: 200,
  htmlContent: "<div>hi</div>",
} as unknown as EmbedNode;

afterEach(() => cleanup());
beforeEach(() => mockLaunch.mockReset());

describe("<EmbedAgentButton />", () => {
  it("renders the trigger and opens an embed-specific composer", () => {
    render(<EmbedAgentButton node={embed} absoluteX={0} absoluteY={0} />);
    fireEvent.click(screen.getByLabelText("Ask agent"));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Ask the agent about this embed…");
  });

  it("launches an embed agent chat on send", () => {
    render(<EmbedAgentButton node={embed} absoluteX={0} absoluteY={0} />);
    fireEvent.click(screen.getByLabelText("Ask agent"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "make it responsive" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(mockLaunch).toHaveBeenCalledWith("embed-1", "make it responsive");
  });
});
