import { isChatDisabled } from "@/lib/chatMode";
import { canLaunchAgent, launchAgentChat } from "@/lib/canvasLink/agentLaunch";
import { clearShowcaseAgentPrompt, peekShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";

let inFlight = false;

/**
 * Hands the stored showcase prompt to the Design Agent. Chatless tab: the prompt stays in
 * sessionStorage until the canvas host is registered AND the agent panel acknowledged the
 * launch, then it is removed; without a host, or without an ack, it is left untouched (and no toast
 * is shown: `App.tsx` calls this again when the host starts). Never sends one prompt twice at once.
 */
export async function launchShowcaseAgentChat(): Promise<boolean> {
  if (inFlight || !canLaunchAgent()) return false;
  const text = peekShowcaseAgentPrompt();
  if (!text) return false;
  inFlight = true;
  try {
    const launched = launchAgentChat({ text }, { toast: false });
    // A local launch is done once launchAgentChat's synchronous part ran; only the agent panel acks later.
    if (!isChatDisabled()) clearShowcaseAgentPrompt();
    const delivered = await launched;
    if (delivered) clearShowcaseAgentPrompt();
    return delivered;
  } finally {
    inFlight = false;
  }
}
