import Link from "@tiptap/extension-link";
import { classifyHref } from "@/lib/docs/docLinks";

/**
 * Link mark that tags links to our own entities (document, canvas frame, canvas tab, trace) for the
 * `.internal-link[data-link-kind]` chip in index.css, using the same `classifyHref` the chat uses.
 * The class and kind exist only in the rendered DOM: they are derived from `href` here, not stored as
 * mark attributes, so the markdown (`[text](href)`) and the saved document stay unmarked.
 */
export const DocLink = Link.extend({
  renderHTML(props) {
    const rendered = this.parent?.(props);
    if (!rendered) return ["a", {}, 0];
    const [tag, attrs, hole] = rendered as [string, Record<string, unknown>, 0];
    // A pasted chip carries its own class; drop it so a re-pointed href cannot keep a stale kind.
    const classes = String(attrs.class ?? "").split(/\s+/).filter((c) => c && c !== "internal-link");
    const next: Record<string, unknown> = { ...attrs };
    delete next["data-link-kind"];
    const target = typeof attrs.href === "string" && attrs.href ? classifyHref(attrs.href) : null;
    if (target && target.kind !== "external") {
      classes.push("internal-link");
      next["data-link-kind"] = target.kind;
    }
    if (classes.length) next.class = classes.join(" ");
    else delete next.class;
    return [tag, next, hole];
  },
});
