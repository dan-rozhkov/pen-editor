import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AgentTaskPanel } from "../AgentTaskPanel";
import type { QueuedChatMessage, Task } from "@/types/chat";

afterEach(() => cleanup());

const TASKS: Task[] = [
  { title: "Read the spec", status: "completed" },
  { title: "Build the panel", status: "in_progress" },
  { title: "Write tests", status: "pending" },
];

describe("<AgentTaskPanel />", () => {
  it("renders nothing when there are no tasks and no queued messages", () => {
    const { container } = render(
      <AgentTaskPanel tasks={[]} queuedMessages={[]} onRemoveQueued={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a row per task with the right status text", () => {
    render(<AgentTaskPanel tasks={TASKS} queuedMessages={[]} onRemoveQueued={vi.fn()} />);
    expect(screen.getByText("Read the spec")).toBeTruthy();
    expect(screen.getByText("Build the panel")).toBeTruthy();
    expect(screen.getByText("Write tests")).toBeTruthy();
  });

  it("shows the completed/total counter", () => {
    render(<AgentTaskPanel tasks={TASKS} queuedMessages={[]} onRemoveQueued={vi.fn()} />);
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("is expanded by default", () => {
    render(<AgentTaskPanel tasks={TASKS} queuedMessages={[]} onRemoveQueued={vi.fn()} />);
    const header = screen.getByRole("button", { name: /tasks/i });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Write tests")).toBeTruthy();
  });

  it("collapses on click, hiding the task list and showing the current task instead", () => {
    render(<AgentTaskPanel tasks={TASKS} queuedMessages={[]} onRemoveQueued={vi.fn()} />);
    const header = screen.getByRole("button", { name: /tasks/i });
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Write tests")).toBeNull();
    // "Build the panel" is in_progress, so the collapsed row shows it.
    expect(screen.getAllByText("Build the panel")).toHaveLength(1);
  });

  it("expands again on a second click", () => {
    render(<AgentTaskPanel tasks={TASKS} queuedMessages={[]} onRemoveQueued={vi.fn()} />);
    const header = screen.getByRole("button", { name: /tasks/i });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Write tests")).toBeTruthy();
  });

  it("shows an all-done summary when every task is completed and collapsed", () => {
    const allDone: Task[] = [
      { title: "One", status: "completed" },
      { title: "Two", status: "completed" },
    ];
    render(<AgentTaskPanel tasks={allDone} queuedMessages={[]} onRemoveQueued={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /tasks/i }));
    expect(screen.getByText("All tasks complete")).toBeTruthy();
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("renders queued message chips and lets the user remove one", () => {
    const queued: QueuedChatMessage[] = [
      { id: "q1", payload: { text: "first queued message" } },
      { id: "q2", payload: { text: "second queued message" } },
    ];
    const onRemoveQueued = vi.fn();
    render(<AgentTaskPanel tasks={[]} queuedMessages={queued} onRemoveQueued={onRemoveQueued} />);
    expect(screen.getByText("first queued message")).toBeTruthy();
    expect(screen.getByText("second queued message")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();

    const removeButtons = screen.getAllByLabelText("Remove queued message");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    expect(onRemoveQueued).toHaveBeenCalledWith("q1");
  });

  it("renders only the queue block when there are no tasks", () => {
    const queued: QueuedChatMessage[] = [{ id: "q1", payload: { text: "queued" } }];
    render(<AgentTaskPanel tasks={[]} queuedMessages={queued} onRemoveQueued={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /tasks/i })).toBeNull();
    expect(screen.getByText("queued")).toBeTruthy();
  });

  it("renders both tasks and queue together", () => {
    const queued: QueuedChatMessage[] = [{ id: "q1", payload: { text: "queued msg" } }];
    render(<AgentTaskPanel tasks={TASKS} queuedMessages={queued} onRemoveQueued={vi.fn()} />);
    expect(screen.getByRole("button", { name: /tasks/i })).toBeTruthy();
    expect(screen.getByText("queued msg")).toBeTruthy();
  });

  // Regression: with 15-20 tasks the panel used to grow to fit its full task
  // list, squeezing MessageList (its flex-1 sibling in ChatSession) down to
  // nothing. The panel's root must stay shrink-0 so it never grows past its
  // intrinsic size within the flex column, and the task <ul> itself must cap
  // its own height and scroll instead of pushing the panel taller.
  it("keeps the panel from growing unbounded: root is shrink-0, the task list is height-capped and scrollable", () => {
    const manyTasks: Task[] = Array.from({ length: 20 }, (_, i) => ({
      title: `Task ${i + 1}`,
      status: "pending" as const,
    }));
    const { container } = render(
      <AgentTaskPanel tasks={manyTasks} queuedMessages={[]} onRemoveQueued={vi.fn()} />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("shrink-0");

    const list = screen.getByText("Task 1").closest("ul") as HTMLElement;
    expect(list.className).toMatch(/max-h-/);
    expect(list.className).toContain("overflow-y-auto");
  });
});
