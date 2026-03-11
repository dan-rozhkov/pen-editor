import type { DocumentComponentDefinition } from "./index";

const MAX_EXPANSION_DEPTH = 5;

// --- Custom tag parser ---

interface CustomTagMatch {
  tag: string;
  attributes: Record<string, string>;
  innerHTML: string | null; // null for self-closing
  startIndex: number;
  endIndex: number;
}

/**
 * Scan HTML for `<c-*>` custom tags, handling balanced nesting.
 * Returns matches with parsed attributes and innerHTML.
 */
function parseCustomTags(html: string): CustomTagMatch[] {
  const matches: CustomTagMatch[] = [];
  let i = 0;

  while (i < html.length) {
    // Look for `<c-`
    const openIdx = html.indexOf("<c-", i);
    if (openIdx === -1) break;

    // Read tag name
    let j = openIdx + 1; // start after '<'
    while (j < html.length && /[a-z0-9-]/i.test(html[j])) j++;
    const tag = html.slice(openIdx + 1, j).toLowerCase();

    if (!tag.startsWith("c-") || tag.length < 3) {
      i = openIdx + 1;
      continue;
    }

    // Parse attributes
    const attributes: Record<string, string> = {};
    while (j < html.length && html[j] !== ">" && !(html[j] === "/" && html[j + 1] === ">")) {
      // Skip whitespace
      if (/\s/.test(html[j])) { j++; continue; }

      // Read attribute name
      const attrStart = j;
      while (j < html.length && html[j] !== "=" && html[j] !== ">" && html[j] !== "/" && !/\s/.test(html[j])) j++;
      const attrName = html.slice(attrStart, j).toLowerCase();
      if (!attrName) { j++; continue; }

      // Check for =
      if (html[j] === "=") {
        j++; // skip =
        let value = "";
        if (html[j] === '"' || html[j] === "'") {
          const quote = html[j];
          j++; // skip opening quote
          const valStart = j;
          while (j < html.length && html[j] !== quote) j++;
          value = html.slice(valStart, j);
          if (j < html.length) j++; // skip closing quote
        } else {
          // Unquoted value
          const valStart = j;
          while (j < html.length && !/[\s>]/.test(html[j])) j++;
          value = html.slice(valStart, j);
        }
        attributes[attrName] = value;
      } else {
        // Boolean attribute
        attributes[attrName] = "";
      }
    }

    if (j >= html.length) break;

    // Self-closing?
    if (html[j] === "/" && html[j + 1] === ">") {
      matches.push({
        tag,
        attributes,
        innerHTML: null,
        startIndex: openIdx,
        endIndex: j + 2,
      });
      i = j + 2;
      continue;
    }

    // Opening tag `>`
    if (html[j] === ">") {
      j++; // skip >
      const contentStart = j;

      // Find balanced closing tag
      let depth = 1;
      const closingTag = `</${tag}>`;
      const openingPrefix = `<${tag}`;

      while (j < html.length && depth > 0) {
        if (html[j] === "<") {
          // Check closing tag
          if (html.slice(j, j + closingTag.length).toLowerCase() === closingTag) {
            depth--;
            if (depth === 0) {
              const innerHTML = html.slice(contentStart, j);
              matches.push({
                tag,
                attributes,
                innerHTML,
                startIndex: openIdx,
                endIndex: j + closingTag.length,
              });
              i = j + closingTag.length;
              break;
            }
            j += closingTag.length;
            continue;
          }
          // Check opening tag of same name
          if (
            html.slice(j, j + openingPrefix.length).toLowerCase() === openingPrefix &&
            j + openingPrefix.length < html.length &&
            /[\s/>]/.test(html[j + openingPrefix.length])
          ) {
            depth++;
          }
        }
        j++;
      }

      // No closing found → treat as self-closing
      if (depth > 0) {
        matches.push({
          tag,
          attributes,
          innerHTML: null,
          startIndex: openIdx,
          endIndex: contentStart, // end after the opening tag's `>`
        });
        i = contentStart;
      }
      continue;
    }

    i = j + 1;
  }

  return matches;
}

// --- Slot extraction ---

interface SlotContent {
  defaultContent: string | null;
  namedSlots: Record<string, string>;
}

/**
 * Extract slot content from the innerHTML of a custom tag.
 * - Top-level elements with `slot="name"` → named slots (element kept, slot attr stripped)
 * - Everything else → default slot content
 */
function extractSlotContent(innerHTML: string | null): SlotContent {
  if (innerHTML === null || innerHTML.trim() === "") {
    return { defaultContent: null, namedSlots: {} };
  }

  const namedSlots: Record<string, string> = {};
  const defaultParts: string[] = [];

  // Parse top-level elements, looking for slot="name" attributes
  let i = 0;
  while (i < innerHTML.length) {
    // Skip whitespace between elements
    if (/\s/.test(innerHTML[i]) && defaultParts.length === 0) {
      const wsStart = i;
      while (i < innerHTML.length && /\s/.test(innerHTML[i])) i++;
      // Keep whitespace if we're collecting default content
      if (i < innerHTML.length && innerHTML[i] !== "<") {
        defaultParts.push(innerHTML.slice(wsStart, i));
      }
      continue;
    }

    if (innerHTML[i] === "<" && innerHTML[i + 1] !== "/") {
      // Start of an element — find the tag
      const elemStart = i;
      i++; // skip <
      const tagStart = i;
      while (i < innerHTML.length && /[a-z0-9-]/i.test(innerHTML[i])) i++;
      const elemTag = innerHTML.slice(tagStart, i).toLowerCase();

      if (!elemTag) {
        // Not a valid tag, treat as text
        defaultParts.push(innerHTML[elemStart]);
        i = elemStart + 1;
        continue;
      }

      // Scan for attributes and find the slot attribute
      let slotName: string | null = null;
      let slotAttrStart = -1;
      let slotAttrEnd = -1;

      while (i < innerHTML.length && innerHTML[i] !== ">" && !(innerHTML[i] === "/" && innerHTML[i + 1] === ">")) {
        if (/\s/.test(innerHTML[i])) { i++; continue; }
        const aStart = i;
        while (i < innerHTML.length && innerHTML[i] !== "=" && innerHTML[i] !== ">" && innerHTML[i] !== "/" && !/\s/.test(innerHTML[i])) i++;
        const aName = innerHTML.slice(aStart, i).toLowerCase();

        if (innerHTML[i] === "=") {
          i++; // skip =
          let aValue = "";
          if (innerHTML[i] === '"' || innerHTML[i] === "'") {
            const q = innerHTML[i];
            i++;
            const vs = i;
            while (i < innerHTML.length && innerHTML[i] !== q) i++;
            aValue = innerHTML.slice(vs, i);
            if (i < innerHTML.length) i++;
          } else {
            const vs = i;
            while (i < innerHTML.length && !/[\s>]/.test(innerHTML[i])) i++;
            aValue = innerHTML.slice(vs, i);
          }
          if (aName === "slot") {
            slotName = aValue;
            slotAttrStart = aStart;
            slotAttrEnd = i;
          }
        } else if (aName === "slot") {
          slotName = "";
          slotAttrStart = aStart;
          slotAttrEnd = i;
        }
      }

      const isSelfClosing = innerHTML[i] === "/" && innerHTML[i + 1] === ">";
      if (isSelfClosing) {
        i += 2;
      } else if (innerHTML[i] === ">") {
        i++; // skip >
        // Find balanced closing tag
        const closingStr = `</${elemTag}>`;
        let depth = 1;
        while (i < innerHTML.length && depth > 0) {
          if (innerHTML[i] === "<") {
            if (innerHTML.slice(i, i + closingStr.length).toLowerCase() === closingStr) {
              depth--;
              if (depth === 0) { i += closingStr.length; break; }
              i += closingStr.length;
              continue;
            }
            const prefix = `<${elemTag}`;
            if (
              innerHTML.slice(i, i + prefix.length).toLowerCase() === prefix &&
              i + prefix.length < innerHTML.length &&
              /[\s/>]/.test(innerHTML[i + prefix.length])
            ) {
              depth++;
            }
          }
          i++;
        }
      }

      const elemHtml = innerHTML.slice(elemStart, i);

      if (slotName !== null && slotName !== "") {
        // Strip the slot attribute from the element
        const beforeSlot = elemHtml.slice(0, slotAttrStart - elemStart);
        const afterSlot = elemHtml.slice(slotAttrEnd - elemStart);
        // Clean up extra whitespace
        const cleaned = beforeSlot.replace(/\s+$/, "") + " " + afterSlot.replace(/^\s+/, "");
        namedSlots[slotName] = cleaned.replace(/\s+>/, ">").replace(/\s+\/>/, " />");
        // Fix: ensure proper cleaning - if stripping left double spaces
        namedSlots[slotName] = namedSlots[slotName].replace(/\s{2,}/g, " ");
      } else {
        defaultParts.push(elemHtml);
      }
    } else {
      // Text node or other content → default
      const textStart = i;
      while (i < innerHTML.length && innerHTML[i] !== "<") i++;
      const text = innerHTML.slice(textStart, i);
      if (text.trim()) {
        defaultParts.push(text);
      }
    }
  }

  const defaultContent = defaultParts.length > 0 ? defaultParts.join("") : null;
  return { defaultContent, namedSlots };
}

// --- Slot injection ---

/**
 * Replace `<slot>` elements in template HTML with provided content.
 * - `<slot>default</slot>` → replaced with defaultContent (or keep default if null)
 * - `<slot name="x">default</slot>` → replaced with namedSlots["x"], or keep default, or remove if in hideList
 * - Remaining `<slot>` wrappers are stripped (replaced with their inner content)
 */
function injectSlots(
  templateHtml: string,
  defaultContent: string | null,
  namedSlots: Record<string, string>,
  hideList: string[],
): string {
  const hideSet = new Set(hideList);
  let result = "";
  let i = 0;

  while (i < templateHtml.length) {
    // Look for <slot
    const slotIdx = templateHtml.indexOf("<slot", i);
    if (slotIdx === -1) {
      result += templateHtml.slice(i);
      break;
    }

    // Make sure it's actually a <slot element (not <slotted or similar)
    const charAfterSlot = templateHtml[slotIdx + 5];
    if (charAfterSlot && !/[\s>\/]/.test(charAfterSlot)) {
      result += templateHtml.slice(i, slotIdx + 5);
      i = slotIdx + 5;
      continue;
    }

    result += templateHtml.slice(i, slotIdx);
    i = slotIdx + 5; // past "<slot"

    // Parse slot attributes
    let slotName: string | null = null;
    while (i < templateHtml.length && templateHtml[i] !== ">" && !(templateHtml[i] === "/" && templateHtml[i + 1] === ">")) {
      if (/\s/.test(templateHtml[i])) { i++; continue; }
      const aStart = i;
      while (i < templateHtml.length && templateHtml[i] !== "=" && templateHtml[i] !== ">" && templateHtml[i] !== "/" && !/\s/.test(templateHtml[i])) i++;
      const aName = templateHtml.slice(aStart, i).toLowerCase();
      if (templateHtml[i] === "=") {
        i++;
        let aValue = "";
        if (templateHtml[i] === '"' || templateHtml[i] === "'") {
          const q = templateHtml[i]; i++;
          const vs = i;
          while (i < templateHtml.length && templateHtml[i] !== q) i++;
          aValue = templateHtml.slice(vs, i);
          if (i < templateHtml.length) i++;
        } else {
          const vs = i;
          while (i < templateHtml.length && !/[\s>]/.test(templateHtml[i])) i++;
          aValue = templateHtml.slice(vs, i);
        }
        if (aName === "name") slotName = aValue;
      }
    }

    const isSelfClosing = templateHtml[i] === "/" && templateHtml[i + 1] === ">";
    let defaultInner = "";

    if (isSelfClosing) {
      i += 2;
    } else if (templateHtml[i] === ">") {
      i++; // skip >
      // Find closing </slot>
      const innerStart = i;
      let depth = 1;
      while (i < templateHtml.length && depth > 0) {
        if (templateHtml[i] === "<") {
          if (templateHtml.slice(i, i + 7).toLowerCase() === "</slot>") {
            depth--;
            if (depth === 0) {
              defaultInner = templateHtml.slice(innerStart, i);
              i += 7;
              break;
            }
            i += 7;
            continue;
          }
          if (
            templateHtml.slice(i, i + 5).toLowerCase() === "<slot" &&
            i + 5 < templateHtml.length &&
            /[\s>\/]/.test(templateHtml[i + 5])
          ) {
            depth++;
          }
        }
        i++;
      }
    }

    // Determine what to output
    if (slotName !== null) {
      // Named slot
      if (hideSet.has(slotName)) {
        // Hidden — output nothing
      } else if (slotName in namedSlots) {
        result += namedSlots[slotName];
      } else {
        result += defaultInner;
      }
    } else {
      // Default slot
      if (defaultContent !== null) {
        result += defaultContent;
      } else {
        result += defaultInner;
      }
    }
  }

  return result;
}

// --- Style merging ---

/**
 * Merge a style attribute from the custom tag into the root element of expanded HTML.
 */
function mergeStyleAttribute(html: string, styleAttr: string | undefined): string {
  if (!styleAttr) return html;

  // Find the first opening tag
  const firstTagMatch = html.match(/^(\s*<[a-z][a-z0-9-]*)([\s>])/i);
  if (!firstTagMatch) return html;

  const tagPrefix = firstTagMatch[1];
  const afterTag = html.slice(tagPrefix.length);

  // Check if there's an existing style attribute
  const styleMatch = afterTag.match(/^([^>]*?)\bstyle\s*=\s*"([^"]*)"/i);
  if (styleMatch) {
    const beforeStyle = afterTag.slice(0, styleMatch.index! + styleMatch[1].length);
    const existingStyle = styleMatch[2];
    const afterStyle = afterTag.slice(styleMatch.index! + styleMatch[0].length);
    const separator = existingStyle.trim().endsWith(";") ? "" : ";";
    return `${tagPrefix}${beforeStyle}style="${existingStyle}${separator}${styleAttr}"${afterStyle}`;
  }

  // No existing style — add it
  return `${tagPrefix} style="${styleAttr}"${afterTag}`;
}

// --- Hide attribute parsing ---

function parseHideAttr(hideAttr: string | undefined): string[] {
  if (!hideAttr) return [];
  return hideAttr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Main expansion ---

/**
 * Expand document component custom tags in HTML.
 *
 * Replaces `<c-user-card />` or `<c-user-card>slot content</c-user-card>` with
 * the component's template HTML, with slot content injected.
 * Repeats up to MAX_EXPANSION_DEPTH for nested component references.
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
    const matches = parseCustomTags(current);
    if (matches.length === 0) break;

    let expandedThisPass = false;

    // Process matches end→start to preserve indices
    for (let m = matches.length - 1; m >= 0; m--) {
      const match = matches[m];
      const comp = tagMap.get(match.tag);

      if (comp) {
        expandedThisPass = true;
        changed = true;
        if (!usedTags.includes(match.tag)) {
          usedTags.push(match.tag);
        }

        const hideList = parseHideAttr(match.attributes["hide"]);
        const { defaultContent, namedSlots } = extractSlotContent(match.innerHTML);
        let expanded = injectSlots(comp.templateHtml, defaultContent, namedSlots, hideList);
        expanded = mergeStyleAttribute(expanded, match.attributes["style"]);

        current =
          current.slice(0, match.startIndex) +
          expanded +
          current.slice(match.endIndex);
      } else {
        // Unknown c-* tag — report issue but leave it
        const issueMsg = `Unknown component tag: <${match.tag}>`;
        if (!issues.includes(issueMsg)) {
          issues.push(issueMsg);
        }
      }
    }

    if (!expandedThisPass) break;

    // Check if we hit depth limit with unresolved tags still present
    if (depth === MAX_EXPANSION_DEPTH - 1) {
      const remaining = parseCustomTags(current);
      const knownRemaining = remaining.some((rm) => tagMap.has(rm.tag));
      if (knownRemaining) {
        issues.push(
          `Expansion depth limit (${MAX_EXPANSION_DEPTH}) reached — some component tags may still be unexpanded (possible recursive reference).`,
        );
      }
    }
  }

  return { expandedHtml: current, changed, usedTags, issues };
}

/**
 * Extract slot names from a component template HTML.
 * Returns slot names found in `<slot>` (as "default") and `<slot name="x">` elements.
 */
export function extractSlotNames(templateHtml: string): string[] {
  const names: string[] = [];
  const slotRegex = /<slot(?:\s+name\s*=\s*"([^"]*)")?\s*[/]?>|<slot(?:\s+name\s*=\s*'([^']*)')?\s*[/]?>/gi;
  let m: RegExpExecArray | null;

  while ((m = slotRegex.exec(templateHtml)) !== null) {
    const name = m[1] ?? m[2] ?? "default";
    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}
