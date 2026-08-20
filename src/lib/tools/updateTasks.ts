import { useChatStore } from "@/store/chatStore";
import type { Task } from "@/types/chat";
import type { ToolExecutionContext, ToolHandler } from "../toolRegistry";

const VALID_STATUSES: Task["status"][] = ["pending", "in_progress", "completed"];
const MAX_TASKS = 20;

function isValidTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const { title, status } = value as { title?: unknown; status?: unknown };
  return (
    typeof title === "string" &&
    title.trim().length > 0 &&
    typeof status === "string" &&
    VALID_STATUSES.includes(status as Task["status"])
  );
}

/**
 * Client-executed handler for the `update_tasks` tool: replaces the current
 * session's task list wholesale (not a merge) and stores it in chatStore for
 * AgentTaskPanel to render. Scoped to `context.sessionId` since the store
 * keys tasks by chat tab — there is no scene-graph mutation here, so unlike
 * most handlers this never touches sceneStore/historyStore.
 */
export const updateTasks: ToolHandler = async (
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<string> => {
  const sessionId = context?.sessionId;
  if (!sessionId) {
    return JSON.stringify({ error: "update_tasks requires a chat session context" });
  }

  const rawTasks = args.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    return JSON.stringify({ error: "tasks must be a non-empty array" });
  }
  if (rawTasks.length > MAX_TASKS) {
    return JSON.stringify({ error: `tasks must contain at most ${MAX_TASKS} items` });
  }
  if (!rawTasks.every(isValidTask)) {
    return JSON.stringify({
      error: `Each task requires a non-empty title and a status of ${VALID_STATUSES.join(", ")}`,
    });
  }

  const tasks: Task[] = rawTasks.map((t) => ({ title: t.title.trim(), status: t.status }));
  useChatStore.getState().setTasks(sessionId, tasks);

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const inProgress = tasks.find((t) => t.status === "in_progress");
  const suffix = inProgress ? `, in progress: "${inProgress.title}"` : "";
  return `Tasks updated: ${completedCount}/${tasks.length} done${suffix}`;
};
