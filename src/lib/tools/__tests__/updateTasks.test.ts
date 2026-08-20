import { describe, it, expect, beforeEach } from "vitest";
import { updateTasks } from "@/lib/tools/updateTasks";
import { useChatStore, NO_TASKS } from "@/store/chatStore";
import { resetStores } from "@/test/fixtures";

const SESSION_ID = "session-1";

beforeEach(() => {
  resetStores();
  useChatStore.setState({ tasks: {} });
});

describe("update_tasks", () => {
  it("errors when there is no session context", async () => {
    const result = JSON.parse(
      await updateTasks({ tasks: [{ title: "A", status: "pending" }] }),
    );
    expect(result.error).toBeTruthy();
  });

  it("errors when tasks is missing, empty, or not an array", async () => {
    const ctx = { sessionId: SESSION_ID };
    expect(JSON.parse(await updateTasks({}, ctx)).error).toBeTruthy();
    expect(JSON.parse(await updateTasks({ tasks: [] }, ctx)).error).toBeTruthy();
    expect(JSON.parse(await updateTasks({ tasks: "nope" }, ctx)).error).toBeTruthy();
  });

  it("errors when a task has an invalid status or empty title", async () => {
    const ctx = { sessionId: SESSION_ID };
    expect(
      JSON.parse(await updateTasks({ tasks: [{ title: "A", status: "done" }] }, ctx)).error,
    ).toBeTruthy();
    expect(
      JSON.parse(await updateTasks({ tasks: [{ title: "  ", status: "pending" }] }, ctx)).error,
    ).toBeTruthy();
  });

  it("errors when tasks exceeds the 20-item cap", async () => {
    const ctx = { sessionId: SESSION_ID };
    const tasks = Array.from({ length: 21 }, (_, i) => ({
      title: `Task ${i}`,
      status: "pending" as const,
    }));
    expect(JSON.parse(await updateTasks({ tasks }, ctx)).error).toBeTruthy();
  });

  it("replaces the session's task list wholesale and reports progress", async () => {
    const ctx = { sessionId: SESSION_ID };
    const result = await updateTasks(
      {
        tasks: [
          { title: "First", status: "completed" },
          { title: "Second", status: "in_progress" },
          { title: "Third", status: "pending" },
        ],
      },
      ctx,
    );
    expect(result).toBe('Tasks updated: 1/3 done, in progress: "Second"');
    expect(useChatStore.getState().tasks[SESSION_ID]).toEqual([
      { title: "First", status: "completed" },
      { title: "Second", status: "in_progress" },
      { title: "Third", status: "pending" },
    ]);
  });

  it("reports progress with no in-progress suffix when nothing is running", async () => {
    const ctx = { sessionId: SESSION_ID };
    const result = await updateTasks(
      { tasks: [{ title: "Only", status: "completed" }] },
      ctx,
    );
    expect(result).toBe("Tasks updated: 1/1 done");
  });

  it("a later call fully replaces the previous list, not merges it", async () => {
    const ctx = { sessionId: SESSION_ID };
    await updateTasks(
      { tasks: [{ title: "Old", status: "pending" }] },
      ctx,
    );
    await updateTasks(
      { tasks: [{ title: "New", status: "pending" }] },
      ctx,
    );
    expect(useChatStore.getState().tasks[SESSION_ID]).toEqual([
      { title: "New", status: "pending" },
    ]);
  });

  it("scopes tasks per session id", async () => {
    await updateTasks(
      { tasks: [{ title: "A", status: "pending" }] },
      { sessionId: "session-a" },
    );
    await updateTasks(
      { tasks: [{ title: "B", status: "pending" }] },
      { sessionId: "session-b" },
    );
    expect(useChatStore.getState().tasks["session-a"]).toEqual([
      { title: "A", status: "pending" },
    ]);
    expect(useChatStore.getState().tasks["session-b"]).toEqual([
      { title: "B", status: "pending" },
    ]);
  });

  it("NO_TASKS stays a stable empty reference for sessions with no tasks", () => {
    expect(useChatStore.getState().tasks["unknown-session"] ?? NO_TASKS).toBe(NO_TASKS);
  });
});
