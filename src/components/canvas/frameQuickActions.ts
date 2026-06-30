import {
  TextAaIcon,
  DatabaseIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { AgentMode } from "@/store/chatStore";

/**
 * A one-click prompt shown in the on-canvas frame agent popup. Clicking an
 * action launches a fresh Design Agent chat seeded with `prompt`, scoped to the
 * selected frame (a screenshot is attached automatically by
 * `launchFrameAgentChat`). `mode`, when set, pins the launched chat to a
 * specific agent mode without changing the user's saved default.
 */
export interface FrameQuickAction {
  id: string;
  label: string;
  icon: Icon;
  prompt: string;
  mode?: AgentMode;
}

export const FRAME_QUICK_ACTIONS: FrameQuickAction[] = [
  {
    id: "rename-layers",
    label: "Rename layers",
    icon: TextAaIcon,
    prompt:
      "Rename the layers inside this frame to short, meaningful names based on their content and role (e.g. \"Heading\", \"Price\", \"CTA button\"). Don't change any visuals — only the layer names.",
  },
  {
    id: "fill-real-data",
    label: "Fill with real data",
    icon: DatabaseIcon,
    prompt:
      "Replace the placeholder text and content in this frame with realistic, plausible real-world data (real-sounding names, prices, dates, copy) that fits the design's purpose. Keep all styling, layout, spacing and fonts exactly as they are.",
  },
  {
    id: "generate-image",
    label: "Generate image",
    icon: ImageIcon,
    prompt:
      "Use the `generate_frame_image` tool to generate an image for this frame and set it as the frame's fill in a single step. First look at the attached frame to decide what imagery fits its purpose (e.g. a hero background, a product photo, a textured backdrop), then call `generate_frame_image` with a detailed prompt and this frame's id. Do NOT use `generate_image` + a manual fill, and do NOT use placeholder/stock images (no picsum) — the real generated image must land on the frame.",
  },
  {
    id: "find-references",
    label: "Find references",
    icon: MagnifyingGlassIcon,
    prompt:
      "Find reference screens and design patterns similar to this frame's layout and purpose. Show inspiring real-world examples I can learn from.",
    mode: "research",
  },
];
