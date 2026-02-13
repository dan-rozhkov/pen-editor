export type MessageRole = "user" | "assistant";
export type ToolCallStatus = "running" | "completed" | "error";

export interface ToolCall {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}
