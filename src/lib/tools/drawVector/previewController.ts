import {
  useAiVectorPreviewStore,
  vectorPreviewKey,
} from "@/store/aiVectorPreviewStore";
import { buildVectorReplayFrames, parseVectorCommands } from "./parser";

interface VectorPreviewInput {
  sessionId: string;
  toolCallId: string;
  name: string;
  commands: string;
}

export function upsertStreamingVectorPreview(input: VectorPreviewInput): void {
  const key = vectorPreviewKey(input.sessionId, input.toolCallId);
  const result = parseVectorCommands(input.commands, "preview");

  if (!result.ok) {
    useAiVectorPreviewStore.getState().finalizeCall(key);
    return;
  }

  if (result.draft.points.length === 0) return;

  useAiVectorPreviewStore.getState().upsert({
    ...result.draft,
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    name: input.name,
    commandText: input.commands,
    phase: "streaming",
    receivedDuringStreaming: true,
  });
}

export async function replayVectorPreview(
  input: VectorPreviewInput & { maxDurationMs?: number },
): Promise<void> {
  const frames = buildVectorReplayFrames(input.commands);
  if (frames.length === 0) return;

  const requestedDuration = input.maxDurationMs ?? 600;
  const maxDurationMs = Number.isFinite(requestedDuration)
    ? Math.min(600, Math.max(0, requestedDuration))
    : 600;
  const delayMs = Math.min(60, Math.max(16, maxDurationMs / frames.length));
  const key = vectorPreviewKey(input.sessionId, input.toolCallId);
  const startedAt = Date.now();

  const publish = (frame: (typeof frames)[number]): boolean => {
    const store = useAiVectorPreviewStore.getState();
    if (store.finalizedKeys.has(key)) return false;
    store.upsert({
      ...frame,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      name: input.name,
      commandText: input.commands,
      phase: "replaying",
      receivedDuringStreaming: false,
    });
    return true;
  };

  // Async functions run synchronously until their first await, so callers can
  // render the initial anchor immediately.
  if (!publish(frames[0])) return;

  for (let index = 1; index < frames.length; index += 1) {
    if (useAiVectorPreviewStore.getState().finalizedKeys.has(key)) return;
    if (Date.now() - startedAt + delayMs > maxDurationMs) return;

    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

    if (useAiVectorPreviewStore.getState().finalizedKeys.has(key)) return;
    if (Date.now() - startedAt > maxDurationMs) return;
    if (!publish(frames[index])) return;
  }
}
