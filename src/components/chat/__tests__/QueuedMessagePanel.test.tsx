import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedChatMessage } from "@/types/chat";
import { QueuedMessagePanel } from "../QueuedMessagePanel";

afterEach(() => cleanup());

describe("<QueuedMessagePanel />", () => {
  it("renders nothing when there are no queued messages", () => {
    const { container } = render(
      <QueuedMessagePanel queuedMessages={[]} onRemoveQueued={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders queued messages and lets the user remove one", () => {
    const queued: QueuedChatMessage[] = [
      { id: "q1", payload: { text: "first queued message" } },
      { id: "q2", payload: { text: "second queued message" } },
    ];
    const onRemoveQueued = vi.fn();

    render(
      <QueuedMessagePanel
        queuedMessages={queued}
        onRemoveQueued={onRemoveQueued}
      />,
    );

    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("first queued message")).toBeTruthy();
    expect(screen.getByText("second queued message")).toBeTruthy();

    const removeButtons = screen.getAllByLabelText("Remove queued message");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(onRemoveQueued).toHaveBeenCalledWith("q1");
  });

  it("shows an image-only queued message", () => {
    const queued: QueuedChatMessage[] = [
      {
        id: "q1",
        payload: {
          text: "",
          images: [{ dataUrl: "data:image/png;base64,AA==", name: "image.png" }],
        },
      },
    ];

    render(
      <QueuedMessagePanel queuedMessages={queued} onRemoveQueued={vi.fn()} />,
    );

    expect(screen.getByText("(image)")).toBeTruthy();
  });

  it("caps and scrolls a long queue without growing the chat panel unbounded", () => {
    const queued: QueuedChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
      id: `q${index}`,
      payload: { text: `Queued message ${index + 1}` },
    }));

    const { container } = render(
      <QueuedMessagePanel queuedMessages={queued} onRemoveQueued={vi.fn()} />,
    );

    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("shrink-0");

    const list = screen.getByText("Queued message 1").closest("ul") as HTMLElement;
    expect(list.className).toMatch(/max-h-/);
    expect(list.className).toContain("overflow-y-auto");
  });
});
