import type { AgentMode } from "@/store/chatStore";

export interface ChatPreset {
  id: string;
  label: string;
  message: string;
  mode: AgentMode;
  model: string;
}

export const CHAT_PRESETS: ChatPreset[] = [
  {
    id: "desktop-screenshot",
    label: "Implement desktop screen from screenshot",
    message:
      "Реализуй экран для [десктопа/мобильного приложения] как на скриншоте",
    mode: "fast",
    model: "google/gemini-3-flash-preview",
  },
  {
    id: "remove-frame-wrappers",
    label: "Remove extra frame wrappers from text nodes",
    message: "Убери лишние frame обертки у текстовых нод на выбранном фрейме",
    mode: "edits",
    model: "moonshotai/kimi-k2.5",
  },
  {
    id: "copy-embed-bitcoin",
    label: "Copy embed with bitcoin trading content",
    message:
      "Скопируй выбранный embed и замени контент на [напишите текст здесь]. Сохрани стили, цвета, отступы и шрифты",
    mode: "fast",
    model: "google/gemini-3-flash-preview",
  },
];
