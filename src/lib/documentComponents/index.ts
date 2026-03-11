import type { FlatSceneNode } from "@/types/scene";
import { getAllComponentsFlat } from "@/utils/componentUtils";
import { extractSlotNames } from "./expander";

export interface DocumentComponentDefinition {
  id: string;
  name: string;
  tag: string;
  width: number;
  height: number;
  templateHtml: string;
  slots: string[];
}

/**
 * Generate a slug-based custom tag from a component name.
 * "User Card" -> "c-user-card"
 * "SidebarNav" -> "c-sidebar-nav"
 */
export function generateComponentTag(name: string): string {
  const slug = name
    // Insert hyphen before uppercase letters in camelCase/PascalCase
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    // Replace non-alphanumeric with hyphens
    .replace(/[^a-zA-Z0-9]+/g, "-")
    // Collapse multiple hyphens
    .replace(/-+/g, "-")
    // Trim leading/trailing hyphens
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `c-${slug || "component"}`;
}

/**
 * Discover all reusable embed components from the current scene
 * and return their definitions with generated tags.
 */
export function collectDocumentComponents(
  nodesById: Record<string, FlatSceneNode>,
): DocumentComponentDefinition[] {
  const embeds = getAllComponentsFlat(nodesById);
  const components = embeds.map((embed) => ({
    id: embed.id,
    name: embed.name ?? "Unnamed",
    tag: generateComponentTag(embed.name ?? "Unnamed"),
    width: embed.width,
    height: embed.height,
    templateHtml: embed.htmlContent,
    slots: extractSlotNames(embed.htmlContent),
  }));

  // Deduplicate tags — track assigned tags to avoid collisions
  const assignedTags = new Set<string>();
  for (const comp of components) {
    let candidate = comp.tag;
    let suffix = 2;
    while (assignedTags.has(candidate)) {
      candidate = `${comp.tag}-${suffix++}`;
    }
    comp.tag = candidate;
    assignedTags.add(candidate);
  }

  return components;
}

/**
 * Build a lookup map from tag name to component definition.
 */
export function buildDocumentComponentTagMap(
  components: DocumentComponentDefinition[],
): Map<string, DocumentComponentDefinition> {
  const map = new Map<string, DocumentComponentDefinition>();
  for (const comp of components) {
    map.set(comp.tag, comp);
  }
  return map;
}
