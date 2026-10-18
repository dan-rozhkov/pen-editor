import { canLaunchAgent, launchAgentChat } from "@/lib/canvasLink/agentLaunch";
import { useCommentsStore } from "@/store/commentsStore";

/**
 * "Send to agent" from a comment thread: open a fresh Design Agent chat seeded
 * with a message that points the agent at comment #N, then reveal the agents
 * panel. The agent takes it from there — it calls `read_comments` to pull the
 * thread (with its node anchor), acts, and can `reply_comment` / `resolve_comment`.
 *
 * Goes through `launchAgentChat` like `launchNodeAgentChat` (no screenshot — the anchor
 * already gives the agent a precise nodeId, and the text names only the comment, as it
 * does locally). Resolves false (no side effects) when the thread doesn't exist, or when
 * nothing can take the launch.
 */
export async function sendCommentToAgent(threadId: string): Promise<boolean> {
  if (!canLaunchAgent()) return false;
  const thread = useCommentsStore.getState().threads.find((t) => t.id === threadId);
  if (!thread) return false;
  return launchAgentChat({ text: `разберись с комментарием #${thread.order}` });
}
