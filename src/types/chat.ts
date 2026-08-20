// Chat types are now provided by the `ai` package (Message, ToolInvocation).
// This file contains app-specific chat payloads shared across the UI/store.

export interface AttachedImage {
  dataUrl: string;
  name: string;
}

export interface ChatLaunchPayload {
  text: string;
  images?: AttachedImage[];
}

/** A message the user submitted while the agent was busy, queued in send order. */
export interface QueuedChatMessage {
  id: string;
  payload: ChatLaunchPayload;
}

/** A single item in the agent's task list, set wholesale via `update_tasks`. */
export interface Task {
  title: string;
  status: "pending" | "in_progress" | "completed";
}
