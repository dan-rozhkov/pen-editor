/**
 * Pure helpers for the embed element picker: building/resolving a stable CSS
 * path to an element inside an embed's live (shadow-DOM) HTML, and
 * describing a picked element for hand-off to the AI agent via
 * `buildCanvasContext` (see `useDesignChat.ts`).
 *
 * Kept framework-free and DOM-only so it round-trips against a real DOM tree
 * in tests without mounting React or Pixi.
 */

const TEXT_PREVIEW_MAX = 120;
const OUTER_HTML_MAX = 1200;

/** A CSS id is only used as a path anchor when it's safe to embed unescaped
 * in a selector and uniquely identifies one element under the given root. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

function isUniqueId(root: ParentNode, id: string): boolean {
  try {
    return root.querySelectorAll(`#${id}`).length === 1;
  } catch {
    return false;
  }
}

/**
 * Build a stable CSS selector path from `root` down to `el`, using
 * `:nth-of-type(n)` segments. Anchors on a `#id` segment (and stops walking
 * further up) as soon as it finds an ancestor with a safe, unique id — this
 * keeps paths short and resilient to reordering above that point.
 *
 * Walks via `parentNode`, not `parentElement`: in production `root` is a
 * `ShadowRoot` (see `EmbedLayer.tsx`), and a top-level content element's
 * `parentElement` is `null` there (its `parentNode` is the shadow root
 * itself, which is a `Node`/`DocumentFragment` but not an `Element`). Using
 * `parentElement` would exit the walk one level early via the "no parent"
 * branch, silently dropping the top-level segment and producing an unrooted
 * path — `root.querySelector(path)` could then match a completely different
 * element elsewhere under `root`. Walking via `parentNode` and comparing
 * against `root` by identity guarantees the loop always terminates by
 * reaching `root`, so every segment down to (but not including) `root` is
 * captured. `resolveElementPath` additionally never escapes this chain when
 * resolving it back — see its doc comment.
 *
 * Returns "" when `el` IS `root` (never a valid pick target — callers should
 * avoid this case; `resolveElementPath` also refuses to resolve it).
 */
export function buildElementPath(el: Element, root: ParentNode): string {
  if ((el as unknown as Node) === (root as unknown as Node)) return "";

  const segments: string[] = [];
  let current: Element | null = el;

  while (current && (current as unknown as Node) !== (root as unknown as Node)) {
    if (current.id && isSafeId(current.id) && isUniqueId(root, current.id)) {
      segments.unshift(`#${current.id}`);
      break;
    }

    const parentNode: Node | null = current.parentNode;
    if (!parentNode) break;

    const tag = current.tagName.toLowerCase();
    const siblingsOfType = Array.from((parentNode as unknown as ParentNode).children).filter(
      (c) => c.tagName === current!.tagName,
    );
    const index = siblingsOfType.indexOf(current) + 1;
    segments.unshift(`${tag}:nth-of-type(${index})`);

    // Stop once we've climbed to `root` itself. `root` may be a ShadowRoot /
    // DocumentFragment — a Node, but not an Element — so it can't be
    // assigned into `current: Element | null`; the loop condition would end
    // the walk on it on the next iteration anyway, so end it here instead.
    current =
      (parentNode as unknown as Node) === (root as unknown as Node)
        ? null
        : (parentNode as Element);
  }

  return segments.join(" > ");
}

function parsePathSegment(
  segment: string,
): { id: string } | { tag: string; index: number } | null {
  if (segment.startsWith("#")) return { id: segment.slice(1) };
  const match = /^([a-zA-Z][a-zA-Z0-9-]*):nth-of-type\((\d+)\)$/.exec(segment);
  if (!match) return null;
  return { tag: match[1], index: Number(match[2]) };
}

/**
 * Resolve a path built by `buildElementPath` back to an Element, or null if
 * the path is empty, invalid, or no longer matches anything under `root`.
 *
 * Resolves segment-by-segment from `root` (via `children` / a `#id`
 * `querySelector` scoped to `root`) instead of handing the whole path to a
 * single `root.querySelector(path)` call. A bare, non-`:scope`-anchored
 * descendant-combinator selector matches ANY matching chain anywhere under
 * `root`, not necessarily the exact chain `buildElementPath` walked — so an
 * unrelated element earlier in document order could resolve instead of the
 * intended one. `:scope`-prefixing the selector would fix that in a real
 * browser, but happy-dom's `querySelector` does not support `:scope` on a
 * `ShadowRoot`/`DocumentFragment` (verified directly: it always returns
 * null there) — exactly the `root` type used in production
 * (`EmbedLayer.tsx`). Walking segment-by-segment sidesteps `:scope`
 * entirely, so resolution is exact and portable in both environments.
 */
export function resolveElementPath(root: ParentNode, path: string): Element | null {
  if (!path) return null;

  let current: ParentNode = root;
  for (const segment of path.split(" > ")) {
    const parsed = parsePathSegment(segment);
    if (!parsed) return null;

    if ("id" in parsed) {
      let match: Element | null;
      try {
        match = root.querySelector(`#${parsed.id}`);
      } catch {
        return null;
      }
      if (!match) return null;
      current = match;
      continue;
    }

    const matches = Array.from(current.children).filter(
      (c) => c.tagName.toLowerCase() === parsed.tag,
    );
    const el = matches[parsed.index - 1];
    if (!el) return null;
    current = el;
  }

  return (current as unknown as Node) === (root as unknown as Node) ? null : (current as Element);
}

/**
 * Walk up from `target` (typically `event.composedPath()[0]`, since shadow
 * DOM retargets `event.target`) to the nearest ancestor-or-self Element that
 * is a valid pick target: inside `root`, not `root` itself, and not a
 * `<script>`/`<style>` element.
 *
 * Explicitly rejects anything not contained in `root` first. Without this, a
 * `target` that sits outside `root`'s subtree entirely — e.g. the shadow
 * *host* element itself, which can surface as `event.composedPath()[0]`
 * from sub-pixel gaps around the overlay host rect, or from a pointer event
 * firing before `htmlContent` has mounted into the shadow root — would
 * still satisfy `node !== root` on the very first loop check and be
 * returned immediately as if it were a legitimate pick inside the embed's
 * content.
 */
export function resolvePickableElement(
  target: EventTarget | null,
  root: ParentNode,
): Element | null {
  let node: Node | null = target instanceof Node ? target : null;
  if (!node || !(root as unknown as Node).contains(node)) return null;

  while (node && (node as unknown as Node) !== (root as unknown as Node)) {
    if (node instanceof Element) {
      const tag = node.tagName.toLowerCase();
      if (tag !== "script" && tag !== "style") return node;
    }
    node = node.parentNode;
  }

  return null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export interface EmbedElementSelection {
  embedId: string;
  path: string;
  tagName: string;
  elementId?: string;
  classes: string[];
  textPreview: string;
  outerHtml: string;
}

/** Describe a picked element for the agent hand-off. */
export function describeEmbedElement(
  el: Element,
  root: ParentNode,
  embedId: string,
): EmbedElementSelection {
  const path = buildElementPath(el, root);
  const textPreview = truncate(
    (el.textContent ?? "").trim().replace(/\s+/g, " "),
    TEXT_PREVIEW_MAX,
  );
  const outerHtml = truncate(el.outerHTML, OUTER_HTML_MAX);

  return {
    embedId,
    path,
    tagName: el.tagName.toLowerCase(),
    ...(el.id ? { elementId: el.id } : {}),
    classes: el.classList ? Array.from(el.classList) : [],
    textPreview,
    outerHtml,
  };
}
