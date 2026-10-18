import { useChatStore } from "@/store/chatStore";

// A session must use ITS OWN chat's model rather than the global active-chat
// value, which openChat overwrites on every switch. Without this, switching
// chats while a background session streams hijacks that session's
// auto-continuation request with the foreground chat's model.
export function resolveSessionModel(sessionId?: string): string {
  const { model, chats } = useChatStore.getState();
  const chat = sessionId ? chats.find((c) => c.id === sessionId) : undefined;
  return chat?.model ?? model;
}
