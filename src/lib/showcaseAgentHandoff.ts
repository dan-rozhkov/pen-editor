const SHOWCASE_AGENT_PROMPT_KEY = "pen:showcase-agent-prompt:v1";

export function storeShowcaseAgentPrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  try {
    sessionStorage.setItem(SHOWCASE_AGENT_PROMPT_KEY, trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

/** Reads the stored prompt WITHOUT removing it (a chatless tab removes it only once the agent panel acked). */
export function peekShowcaseAgentPrompt(): string | null {
  try {
    return sessionStorage.getItem(SHOWCASE_AGENT_PROMPT_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function clearShowcaseAgentPrompt(): void {
  try {
    sessionStorage.removeItem(SHOWCASE_AGENT_PROMPT_KEY);
  } catch {
    // Nothing to remove.
  }
}
