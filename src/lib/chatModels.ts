// Single source of truth for the chat model list and per-model capabilities.
// `supportsVision: false` models get image parts stripped before sending
// (see useDesignChat) and image attaching disabled in ChatInput.

export interface ChatModelOption {
  value: string;
  label: string;
  supportsVision: boolean;
}

export const MODEL_OPTIONS: ChatModelOption[] = [
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    supportsVision: true,
  },
  {
    value: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    supportsVision: true,
  },
  {
    value: "minimax/minimax-m3",
    label: "Minimax M3",
    supportsVision: true,
  },
];

const visionByModel = new Map(
  MODEL_OPTIONS.map((option) => [option.value, option.supportsVision])
);

export function modelSupportsVision(model: string): boolean {
  // Unknown models (e.g. custom OPENROUTER_MODEL) are assumed vision-capable;
  // the stripping is a safety net, not a hard gate.
  return visionByModel.get(model) ?? true;
}
