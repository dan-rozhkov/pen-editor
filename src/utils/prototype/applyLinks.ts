/**
 * Apply a resolved link graph to a screen's `annotatedHtml` (from
 * `extractPrototypeCandidates`). For each link, the matching
 * `[data-proto-id]` element gets navigation wired to `<targetSlug>.html`:
 * an `<a>` has its `href` rewritten; anything else is wrapped in a new
 * `<a>`. All `data-proto-id` attributes (matched or not) are stripped
 * before returning, so the shipped HTML carries no trace of the
 * extraction pass.
 */
export function applyPrototypeLinks(
  annotatedHtml: string,
  links: { protoId: string; targetSlug: string }[],
): string {
  const doc = new DOMParser().parseFromString(annotatedHtml, "text/html");
  for (const { protoId, targetSlug } of links) {
    const el = doc.querySelector(`[data-proto-id="${CSS.escape(protoId)}"]`);
    if (!el) continue;
    const target = `${targetSlug}.html`;
    if (el.tagName.toLowerCase() === "a") {
      el.setAttribute("href", target);
    } else {
      const a = doc.createElement("a");
      a.setAttribute("href", target);
      el.parentNode?.insertBefore(a, el);
      a.appendChild(el);
    }
  }
  doc.querySelectorAll("[data-proto-id]").forEach((el) => el.removeAttribute("data-proto-id"));
  return doc.body.innerHTML;
}
