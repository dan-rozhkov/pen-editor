import type { DocumentComponentDefinition } from "./index";

const MAX_EXPANSION_DEPTH = 5;

/** Create a fresh regex per call to avoid stale lastIndex from the `g` flag. */
function customTagRegex(): RegExp {
  // Matches self-closing <c-foo /> and paired <c-foo>...</c-foo> tags
  return /<(c-[a-z0-9-]+)\s*\/?>|<(c-[a-z0-9-]+)[^>]*>[\s\S]*?<\/\2>/gi;
}

/**
 * Expand document component custom tags in HTML.
 *
 * Replaces `<c-user-card />` or `<c-user-card></c-user-card>` with
 * the component's template HTML. Repeats up to MAX_EXPANSION_DEPTH
 * for nested component references.
 */
export function expandDocumentComponentTags(
  html: string,
  tagMap: Map<string, DocumentComponentDefinition>,
): {
  expandedHtml: string;
  changed: boolean;
  usedTags: string[];
  issues: string[];
} {
  const usedTags: string[] = [];
  const issues: string[] = [];
  let current = html;
  let changed = false;

  for (let depth = 0; depth < MAX_EXPANSION_DEPTH; depth++) {
    let expandedThisPass = false;

    current = current.replace(customTagRegex(), (match, selfClosingTag, pairedTag) => {
      const tag = (selfClosingTag ?? pairedTag)?.toLowerCase();
      if (!tag) return match;

      const comp = tagMap.get(tag);
      if (comp) {
        expandedThisPass = true;
        changed = true;
        if (!usedTags.includes(tag)) {
          usedTags.push(tag);
        }
        return comp.templateHtml;
      }

      // Unknown c-* tag — report issue but leave it
      if (!issues.includes(`Unknown component tag: <${tag}>`)) {
        issues.push(`Unknown component tag: <${tag}>`);
      }
      return match;
    });

    if (!expandedThisPass) break;

    // Check if we hit depth limit with unresolved tags still present
    if (depth === MAX_EXPANSION_DEPTH - 1) {
      const remaining = current.match(customTagRegex());
      if (remaining) {
        const knownRemaining = remaining.some((m) => {
          const t = m.match(/<(c-[a-z0-9-]+)/i)?.[1]?.toLowerCase();
          return t && tagMap.has(t);
        });
        if (knownRemaining) {
          issues.push(
            `Expansion depth limit (${MAX_EXPANSION_DEPTH}) reached — some component tags may still be unexpanded (possible recursive reference).`,
          );
        }
      }
    }
  }

  return { expandedHtml: current, changed, usedTags, issues };
}
