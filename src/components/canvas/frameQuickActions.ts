import {
  TextAaIcon,
  DatabaseIcon,
  SparkleIcon,
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
    id: "polish-design",
    label: "Polish design",
    icon: SparkleIcon,
    prompt:
      "Polish the visual design of this frame: refine spacing and padding, align elements onto a consistent grid, and tidy up the typographic hierarchy. Make small, safe improvements — keep the overall structure and intent intact.",
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
