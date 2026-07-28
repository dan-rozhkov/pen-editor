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

export function consumeShowcaseAgentPrompt(): string | null {
  try {
    const prompt = sessionStorage.getItem(SHOWCASE_AGENT_PROMPT_KEY);
    sessionStorage.removeItem(SHOWCASE_AGENT_PROMPT_KEY);
    const trimmed = prompt?.trim() ?? "";
    return trimmed || null;
  } catch {
    return null;
  }
}
