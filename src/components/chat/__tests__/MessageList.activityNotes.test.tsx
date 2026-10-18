import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  const chip = screen.getByText("Memory updated");
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
  expect(screen.queryByText("Memory updated")).toBeNull();
});

function userText(id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: id }] } as UIMessage;
}

describe("turnMessageId anchoring", () => {
  const turns = [userText("u1"), assistantText("a1", "one"), assistantText("a1b", "one-b"), userText("u2"), assistantText("a2", "two")];

  it("renders under the last assistant reply of that turn, not under a later turn", () => {
    const { container } = render(
      <MessageList messages={turns} isLoading={false} activityNotes={[{ id: "memory-activity-5", turnMessageId: "u1" }]} />,
    );
    const chip = screen.getByText("Memory updated");
    const blocks = Array.from(container.querySelectorAll(".group"));
    const holders = blocks.filter((b) => b.contains(chip));
    expect(holders).toHaveLength(1);
    expect(holders[0].textContent).toContain("one-b");
  });

  it.each([
    ["a missing id", [userText("u1"), assistantText("a1", "x")], "gone"],
    ["a turn with no assistant reply", [userText("u1")], "u1"],
  ])("renders nothing for %s", (_n, messages, turnMessageId) => {
    render(<MessageList messages={messages} isLoading={false} activityNotes={[{ id: "memory-activity-5", turnMessageId }]} />);
    expect(screen.queryByText("Memory updated")).toBeNull();
  });
});

it("a background note with changes toggles its details; without changes it has no chevron", () => {
  const long = "x".repeat(300);
  const { unmount } = render(
    <MessageList
      messages={[assistantText("m1", "first")]}
      isLoading={false}
      activityNotes={[
        {
          id: "n1",
          afterMessageId: "m1",
          changesByEvent: {
            "1": [
              { kind: "memory", target: "memory", action: "add", content: long },
              { kind: "skill", action: "delete", name: "old", absorbedInto: "new" },
            ],
          },
        },
      ]}
    />,
  );
  expect(screen.queryByText("Deleted skill old (merged into new)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Memory updated/ }));
  expect(screen.getByText(`Remembered: ${long}`).className).toContain("break-words");
  expect(screen.getByText("Deleted skill old (merged into new)")).toBeTruthy();
  unmount();

  render(
    <MessageList
      messages={[assistantText("m1", "first")]}
      isLoading={false}
      activityNotes={[{ id: "n2", afterMessageId: "m1" }]}
    />,
  );
  expect(screen.getByText("Memory updated")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Memory updated/ })).toBeNull();
});
