import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessageList } from "../MessageList";

afterEach(() => cleanup());

function assistantText(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] } as UIMessage;
}

it("renders the memory chip inside the anchored assistant message, not the other one", () => {
  const { container } = render(
    <MessageList
      messages={[assistantText("m1", "first"), assistantText("m2", "second")]}
      isLoading={false}
      activityNotes={[{ id: "memory-activity-5", afterMessageId: "m1" }]}
    />,
  );
  const chip = screen.getByText("Память обновлена");
  const blocks = container.querySelectorAll(".group");
  expect(blocks[0].contains(chip)).toBe(true);
  expect(blocks[1].contains(chip)).toBe(false);
});

it("renders nothing for a note whose message is gone (rolled back)", () => {
  render(
    <MessageList
      messages={[assistantText("m1", "first")]}
      isLoading={false}
      activityNotes={[{ id: "memory-activity-5", afterMessageId: "gone" }]}
    />,
  );
  expect(screen.queryByText("Память обновлена")).toBeNull();
});
