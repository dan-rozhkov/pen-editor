import { collapseComponentRegions, type ComponentRegistry } from "@/lib/embedComponents";
import type { EmbedNode } from "@/types/scene";

export type EmbedView = "compact" | "expanded";

/**
 * The text a tool shows and matches anchors against. A master is always its
 * stored text, and so is any screen the compact view cannot represent; the
 * returned `view` says which text this really is.
 */
export function embedTextForView(
  embed: Pick<EmbedNode, "htmlContent" | "component">,
  requested: unknown,
  registry: ComponentRegistry,
): { text: string; view: EmbedView } {
  const stored = embed.htmlContent;
  if (requested === "expanded" || embed.component) return { text: stored, view: "expanded" };
  const text = collapseComponentRegions(stored, registry);
  return { text, view: text === stored ? "expanded" : "compact" };
}
