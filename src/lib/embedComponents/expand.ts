import { parseMaster } from "./master";
import { reconcileHtml } from "./reconcile";
import { renderInstance } from "./render";
import type { ComponentRegistry, InstanceSpec, ParsedMaster } from "./types";

export interface ExpandResult {
  /** Expanded (and reconciled) HTML; the input string when nothing matched. */
  html: string;
  /** `<c-name>` tags whose name is not a registered key (left untouched). */
  unknownTags: string[];
  /** Non-fatal problems the agent should hear about. */
  warnings: string[];
}

interface TagToken {
  type: "open" | "close" | "self";
  name: string;
  start: number;
  end: number;
  attrs: Record<string, string>;
}

interface TagNode {
  name: string;
  attrs: Record<string, string>;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  children: TagNode[];
}

const DEAD_RANGES = /<!--[\s\S]*?(?:-->|$)|<script\b[\s\S]*?(?:<\/script\s*>|$)|<style\b[\s\S]*?(?:<\/style\s*>|$)/gi;
const TAG_START = /<(\/)?c-([a-z][a-z0-9-]*)(?=[\s/>])/g;
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeAttr(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** Same-length copy of `html` with scripts, styles and comments blanked. */
export function maskDeadRanges(html: string): string {
  return html.replace(DEAD_RANGES, (m) => " ".repeat(m.length));
}

/** End index (exclusive) of the tag opened at `from`, quote-aware; -1 if cut off. */
export function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return -1;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(source))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    const raw = m[2] ?? m[3] ?? m[4];
    attrs[name] = raw === undefined ? "true" : decodeAttr(raw);
  }
  return attrs;
}

function tokenize(
  html: string,
  masked: string,
  unknown: string[],
  isKnown: (name: string) => boolean,
): TagToken[] {
  const tokens: TagToken[] = [];
  TAG_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_START.exec(masked))) {
    const closing = m[1] === "/";
    const name = m[2];
    const reserved = name === "slot";
    if (!reserved && !isKnown(name)) {
      if (!closing && !unknown.includes(name)) unknown.push(name);
      continue;
    }
    const end = findTagEnd(masked, m.index + m[0].length);
    if (end === -1) break; // cut-off tag (partial stream): nothing past it is reliable
    if (closing) {
      tokens.push({ type: "close", name, start: m.index, end, attrs: {} });
    } else {
      const inside = html.slice(m.index + m[0].length, end - 1);
      const selfClosing = /\/\s*$/.test(inside);
      tokens.push({
        type: selfClosing ? "self" : "open",
        name,
        start: m.index,
        end,
        attrs: parseAttrs(selfClosing ? inside.replace(/\/\s*$/, "") : inside),
      });
    }
    TAG_START.lastIndex = end;
  }
  return tokens;
}

function buildTree(
  tokens: TagToken[],
  warnings: string[],
  partialEnd: number | null,
  openStarts?: number[],
): TagNode[] {
  const roots: TagNode[] = [];
  const stack: TagNode[] = [];
  const attach = (node: TagNode) => {
    (stack.length > 0 ? stack[stack.length - 1].children : roots).push(node);
  };
  /** Never-closed nodes stay as written; the nodes that DID close inside them are kept. */
  const abandon = (dropped: TagNode[], into: TagNode[]) => {
    for (const d of dropped) {
      warnings.push(`<c-${d.name}> was never closed and was left as written`);
      openStarts?.push(d.start);
      into.push(...d.children);
    }
  };
  for (const t of tokens) {
    if (t.type === "self") {
      attach({
        name: t.name, attrs: t.attrs, start: t.start, end: t.end,
        innerStart: t.end, innerEnd: t.end, children: [],
      });
    } else if (t.type === "open") {
      stack.push({
        name: t.name, attrs: t.attrs, start: t.start, end: -1,
        innerStart: t.end, innerEnd: -1, children: [],
      });
    } else {
      const idx = stack.map((n) => n.name).lastIndexOf(t.name);
      if (idx === -1) continue; // stray closing tag
      abandon(stack.splice(idx + 1), stack[idx].children);
      const node = stack.pop() as TagNode;
      node.end = t.end;
      node.innerEnd = t.start;
      attach(node);
    }
  }
  if (partialEnd !== null) {
    // A stream cut the input: open nodes are closed at the end of the text.
    while (stack.length > 0) {
      const node = stack.pop() as TagNode;
      node.end = partialEnd;
      node.innerEnd = partialEnd;
      attach(node);
    }
  } else {
    abandon(stack.splice(0), roots);
  }
  return roots;
}

/**
 * Rebuild html[from, to) with each component node replaced by its rendering.
 * `<c-slot>` nodes are cut out (`dropSlots`: they were consumed as named
 * slots by the owning component) — never left behind in bare content.
 */
function renderNodes(
  html: string,
  nodes: TagNode[],
  from: number,
  to: number,
  renderComponent: (node: TagNode) => string,
  dropSlots: boolean,
): string {
  let out = "";
  let cursor = from;
  for (const node of nodes) {
    out += html.slice(cursor, node.start);
    cursor = node.end;
    if (node.name !== "slot") out += renderComponent(node);
    else if (!dropSlots) out += html.slice(node.start, node.end);
  }
  return out + html.slice(cursor, to);
}

/** A `<c-slot>` outside any component is plain text; its children are not. */
function liftOrphanSlots(nodes: TagNode[]): TagNode[] {
  return nodes.flatMap((n) => (n.name === "slot" ? liftOrphanSlots(n.children) : [n]));
}

/**
 * Cheap text test: does `html` hold a raw `<c-key>` tag for a key that is
 * registered NOW (e.g. written before the component was defined)? May say yes
 * for a tag inside a script or comment; the caller then pays one parse.
 */
export function mentionsRegisteredTag(html: string, registry: ComponentRegistry): boolean {
  if (!html || !html.includes("<c-")) return false;
  const re = /<c-([a-z][a-z0-9-]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) if (m[1] !== "slot" && registry.has(m[1])) return true;
  return false;
}

export interface ExpandOptions {
  /** Input is a stream prefix: tags still open are closed at the end of the text. */
  partial?: boolean;
  /** Skip the reconcile pass (no managed `<style>`, no rev check). Default true. */
  reconcile?: boolean;
}

/**
 * End index of the last component node that is complete, so the text before
 * it expands the same whatever follows (0 when there is none). Streaming
 * previews cache the expansion of that prefix.
 */
export function stableExpansionEnd(html: string, registry: ComponentRegistry): number {
  if (!html.includes("<c-")) return 0;
  const masked = maskDeadRanges(html);
  const tokens = tokenize(html, masked, [], (n) => registry.has(n));
  const openStarts: number[] = [];
  const roots = liftOrphanSlots(buildTree(tokens, [], null, openStarts));
  // A node closed INSIDE a never-closed one is not stable: the open tag
  // before it may still become a component.
  const limit = openStarts.length > 0 ? Math.min(...openStarts) : Infinity;
  const stable = roots.filter((r) => r.end <= limit);
  return stable.length > 0 ? stable[stable.length - 1].end : 0;
}

/**
 * Expand `<c-key ...>` tags of REGISTERED keys into stored component
 * regions, then reconcile (managed `<style>`, nested components, rev).
 *
 * - Only registered keys match; the scan skips `<script>`, `<style>` and
 *   comments, so `i<c-1` in a script, or any unregistered `<c-x>`, is left
 *   exactly as written (unregistered names are reported in `unknownTags`).
 * - `<c-btn />` is the same as `<c-btn></c-btn>`.
 * - Bare content goes to the component's first slot; `<c-slot name="x">`
 *   children fill named slots.
 * - Attributes that name a declared variant axis become `data-v-*`; `style`
 *   and `id` stay on the instance; anything else is dropped with a warning.
 */
export function expandComponentTags(
  html: string,
  registry: ComponentRegistry,
  options: ExpandOptions = {},
): ExpandResult {
  const result: ExpandResult = { html, unknownTags: [], warnings: [] };
  if (!html || !html.includes("<c-")) return result;

  const masters = new Map<string, ParsedMaster>();
  for (const [key, master] of registry) {
    const parsed = parseMaster(master);
    if (parsed) masters.set(key, parsed);
  }

  const masked = maskDeadRanges(html);
  const tokens = tokenize(html, masked, result.unknownTags, (n) => masters.has(n));
  const roots = liftOrphanSlots(buildTree(tokens, result.warnings, options.partial ? html.length : null));
  if (roots.length === 0) return result;

  const renderComponent = (node: TagNode): string => {
    const parsed = masters.get(node.name);
    if (!parsed) return html.slice(node.start, node.end);
    const master = registry.get(node.name);
    if (!master) return html.slice(node.start, node.end);

    const spec: InstanceSpec = { variants: {}, slots: {}, attrs: {} };
    for (const [attr, value] of Object.entries(node.attrs)) {
      if (attr in parsed.axes) spec.variants![attr] = value;
      else if (attr === "style" || attr === "id") spec.attrs![attr] = value;
      else {
        result.warnings.push(
          `<c-${node.name}> attribute "${attr}" is not a variant axis ` +
            `(axes: ${Object.keys(parsed.axes).join(", ") || "none"}); only style and id are kept`,
        );
      }
    }

    for (const child of node.children) {
      if (child.name !== "slot") continue;
      const slotName = child.attrs.name;
      if (!slotName || !parsed.slots.includes(slotName)) {
        result.warnings.push(
          `<c-${node.name}> has no slot "${slotName ?? ""}" (slots: ${parsed.slots.join(", ") || "none"})`,
        );
        continue;
      }
      spec.slots![slotName] = renderNodes(html, child.children, child.innerStart, child.innerEnd, renderComponent, true).trim();
    }

    const bare = renderNodes(html, node.children, node.innerStart, node.innerEnd, renderComponent, true).trim();
    if (bare) {
      const first = parsed.slots[0];
      if (!first) {
        result.warnings.push(`<c-${node.name}> has no slots, so its content was dropped`);
      } else if (first in spec.slots!) {
        result.warnings.push(
          `<c-${node.name}> got bare content and an explicit slot "${first}"; the bare content was dropped`,
        );
      } else {
        spec.slots![first] = bare;
      }
    }
    return renderInstance(master, spec);
  };

  const expanded = renderNodes(html, roots, 0, html.length, renderComponent, false);
  result.html = options.reconcile === false ? expanded : reconcileHtml(expanded, registry);
  return result;
}
