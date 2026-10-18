import { analyzeImage } from "@/lib/tools/analyzeImage";
import { askUser } from "@/lib/tools/askUser";
import type { ToolHandler } from "./toolTypes";

/**
 * Tools that belong to no surface, decided by what each one operates on:
 * - `ask_user` talks to the person in the chat (answered by the in-chat form).
 * - `analyze_image` looks at an image by URL (backend-executed); it touches
 *   neither the scene graph nor a browser page.
 * Everything else reads or mutates the canvas scene or drives a browser.
 */
export const sharedTools: Record<string, ToolHandler> = {
  ask_user: askUser,
  analyze_image: analyzeImage,
};
