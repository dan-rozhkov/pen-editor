// Single source of truth for the chat model list and per-model capabilities.
// `supportsVision: false` models get image parts stripped before sending
// (see useDesignChat) and image attaching disabled in ChatInput.

export interface ChatModelOption {
  value: string;
  label: string;
  supportsVision: boolean;
}

export const MODEL_OPTIONS: ChatModelOption[] = [
  { value: "openai/gpt-5.4", label: "GPT-5.4", supportsVision: true },
  { value: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", supportsVision: true },
  { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5", supportsVision: true },
  {
    value: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    supportsVision: true,
  },
  {
    value: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    supportsVision: true,
  },
  { value: "z-ai/glm-5", label: "GLM-5", supportsVision: false },
  { value: "z-ai/glm-5-turbo", label: "GLM-5 Turbo", supportsVision: false },
  {
    value: "minimax/minimax-m2.5",
    label: "Minimax M2.5",
    supportsVision: false,
  },
  {
    value: "minimax/minimax-m2.7",
    label: "Minimax M2.7",
    supportsVision: false,
  },
  {
    value: "qwen/qwen3.5-397b-a17b",
    label: "Qwen 3.5 397B",
    supportsVision: true,
  },
  {
    value: "qwen/qwen3.5-plus-02-15",
    label: "Qwen 3.5 Plus",
    supportsVision: true,
  },
  {
    value: "qwen/qwen3.5-flash-02-23",
    label: "Qwen 3.5 Flash",
    supportsVision: true,
  },
  {
    value: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    supportsVision: true,
  },
  {
    value: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    supportsVision: true,
  },
  {
    value: "google/gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite",
    supportsVision: true,
  },
  { value: "x-ai/grok-4.20-beta", label: "Grok 4.20", supportsVision: true },
  {
    value: "xiaomi/mimo-v2-omni",
    label: "MiMo V2 Omni",
    supportsVision: true,
  },
  {
    value: "xiaomi/mimo-v2-pro",
    label: "MiMo V2 Pro",
    supportsVision: false,
  },
  {
    value: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B",
    supportsVision: false,
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
