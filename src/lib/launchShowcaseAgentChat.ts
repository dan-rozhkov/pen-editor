import { isChatDisabled } from "@/lib/chatMode";
import { canLaunchAgent, isCanvasHostRunning, launchAgentChat, nextLaunchId } from "@/lib/canvasLink/agentLaunch";
import { clearShowcaseAgentPrompt, peekShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";

/** A chatless tab asks the agent panel up to this many times before it waits for the next host start. */
export const SHOWCASE_LAUNCH_ATTEMPTS = 3;
/** Pause between two attempts (the panel may still be loading). */
export const SHOWCASE_LAUNCH_RETRY_DELAY_MS = 5000;

let inFlight = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Hands the stored showcase prompt to the Design Agent. Chatless tab: the prompt stays in
 * sessionStorage until the canvas host is registered AND the agent panel acknowledged the
 * launch, then it is removed. Without a host it is left untouched (and no toast is shown:
 * `App.tsx` calls this again when the host starts). A launch the panel did not ack is retried
 * (`SHOWCASE_LAUNCH_ATTEMPTS`, `SHOWCASE_LAUNCH_RETRY_DELAY_MS` apart) while the host runs; after the
 * last attempt the prompt is still kept for the next host start. Never sends one prompt twice at once
 * (the guard covers the whole retry sequence and is always released).
 */
export async function launchShowcaseAgentChat(): Promise<boolean> {
  if (inFlight || !canLaunchAgent()) return false;
  if (!peekShowcaseAgentPrompt()) return false;
  inFlight = true;
  // One id for every attempt: the panel handles it once and re-acks a repeat (no second chat).
  const launchId = nextLaunchId();
  try {
    for (let attempt = 0; attempt < SHOWCASE_LAUNCH_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(SHOWCASE_LAUNCH_RETRY_DELAY_MS);
        if (!isCanvasHostRunning()) return false; // the next host start retries
      }
      const text = peekShowcaseAgentPrompt();
      if (!text) return false; // taken by someone else meanwhile
      const launched = launchAgentChat({ text }, { toast: false, launchId });
      // A local launch is done once launchAgentChat's synchronous part ran: clear in the same tick.
      if (!isChatDisabled()) {
        clearShowcaseAgentPrompt();
        return launched;
      }
      if (await launched) {
        clearShowcaseAgentPrompt();
        return true;
      }
    }
    return false;
  } finally {
    inFlight = false;
  }
}
