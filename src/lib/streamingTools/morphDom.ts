/**
 * Minimal pure-DOM morph used by the streaming embed preview: patch a LIVE
 * tree toward a freshly built one instead of replacing it, so nodes that did
 * not change (above all `<img>`/`<iframe>`/`<video>`, which reload when
 * recreated) keep their identity — and any animation running on them — while
 * the streamed html grows at the tail.
 *
 * Rules, walking children pairwise (`live[i]` vs `next[i]`):
 * - same node type + tag (+ namespace) element: keep the live node, sync
 *   attributes (only attributes whose value actually differs are written, so
 *   an unchanged `src`/`srcset` is never touched and nothing reloads), recurse;
 * - `<style>`/`<script>`: update `textContent` only if different, no recursion;
 * - text/comment nodes: update `data` only if different;
 * - anything else: replace the live node with the new one;
 * - surplus new children are appended; surplus live children are removed.
 *
 * Returns the OUTERMOST elements that were inserted (replaced or appended) —
 * elements nested inside an inserted root are not reported, so a reveal
 * animation is applied once per new subtree instead of stacking on descendants.
 * Nodes are MOVED out of `next` into `live`; `next` is a throwaway tree.
 */

const TEXT_ONLY_ELEMENTS = new Set(["STYLE", "SCRIPT"]);

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const ea = a as Element;
  const eb = b as Element;
  return ea.localName === eb.localName && ea.namespaceURI === eb.namespaceURI;
}

function syncAttributes(live: Element, next: Element): void {
  for (const attr of Array.from(live.attributes)) {
    if (!next.hasAttribute(attr.name)) live.removeAttribute(attr.name);
  }
  for (const attr of Array.from(next.attributes)) {
    // Writing an identical `src` would restart an img/iframe/video load, so
    // only differing values are ever written.
    if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
  }
}

export function morphChildren(live: Node, next: Node): Element[] {
  const inserted: Element[] = [];
  const liveKids = Array.from(live.childNodes);
  const nextKids = Array.from(next.childNodes);
  const common = Math.min(liveKids.length, nextKids.length);

  for (let i = 0; i < common; i++) {
    const l = liveKids[i];
    const n = nextKids[i];
    if (!sameKind(l, n)) {
      live.replaceChild(n, l);
      if (n.nodeType === Node.ELEMENT_NODE) inserted.push(n as Element);
      continue;
    }
    if (l.nodeType === Node.ELEMENT_NODE) {
      const le = l as Element;
      const ne = n as Element;
      syncAttributes(le, ne);
      if (TEXT_ONLY_ELEMENTS.has(le.tagName)) {
        if (le.textContent !== ne.textContent) le.textContent = ne.textContent;
      } else {
        inserted.push(...morphChildren(le, ne));
      }
    } else if ((l as CharacterData).data !== (n as CharacterData).data) {
      (l as CharacterData).data = (n as CharacterData).data;
    }
  }

  for (let i = common; i < nextKids.length; i++) {
    const n = nextKids[i];
    live.appendChild(n);
    if (n.nodeType === Node.ELEMENT_NODE) inserted.push(n as Element);
  }
  for (let i = liveKids.length - 1; i >= common; i--) {
    live.removeChild(liveKids[i]);
  }
  return inserted;
}
