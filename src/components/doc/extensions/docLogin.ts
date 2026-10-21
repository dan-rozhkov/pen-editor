import { mergeAttributes, Node } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { loginChipLabel } from "@/lib/docs/savedLogins";
import { LoginChipView } from "./LoginChipView";

// A reference to a login saved in the desktop app, typed as `@` in the document. Stored as a
// markdown link whose target is the `login:` scheme, so the agent reads who and where:
//
//   [@alice · github.com](login:3f2a)
//
// The id is the only thing that resolves the login; the label is a snapshot. No password is stored.

const SEPARATOR = " · ";
/** `[@label](login:id)`; the label may hold backslash-escaped characters. */
const LOGIN_LINK = /^\[@((?:\\.|[^\]\\\n])*)\]\(login:([^)\s]+)\)/;

/** Escapes what would end or split the label: brackets, the table pipe, and the `·` of the separator. Line breaks become spaces. */
const escapeLabel = (text: string) => text.replace(/\r\n|[\r\n]/g, " ").replace(/[\\[\]|·]/g, "\\$&");
/** encodeURIComponent leaves ( and ) alone, which would end the link target early. */
const encodeId = (id: string) => encodeURIComponent(id).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));
const unescapeLabel = (text: string) => text.replace(/\\(.)/g, "$1");

function tokenizeLogin(src: string): MarkdownToken | undefined {
  const match = LOGIN_LINK.exec(src);
  if (!match) return undefined;
  let id: string;
  try {
    id = decodeURIComponent(match[2]);
  } catch {
    return undefined;
  }
  // Split before unescaping: an escaped `\·` in a name never forms the separator.
  const label = match[1];
  const cut = label.lastIndexOf(SEPARATOR);
  return {
    type: "docLogin",
    raw: match[0],
    id,
    username: unescapeLabel(cut < 0 ? label : label.slice(0, cut)),
    host: cut < 0 ? "" : unescapeLabel(label.slice(cut + SEPARATOR.length)),
  };
}

export const DocLogin = Node.create({
  name: "docLogin",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: { default: "", parseHTML: (el) => el.getAttribute("data-id") ?? "", renderHTML: (attrs) => ({ "data-id": attrs.id }) },
      username: { default: "", parseHTML: (el) => el.getAttribute("data-username") ?? "", renderHTML: (attrs) => ({ "data-username": attrs.username }) },
      host: { default: "", parseHTML: (el) => el.getAttribute("data-host") ?? "", renderHTML: (attrs) => ({ "data-host": attrs.host }) },
    };
  },

  parseHTML: () => [{ tag: 'span[data-type="doc-login"]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-type": "doc-login", class: "doc-login" }),
    loginChipLabel(node.attrs.username, node.attrs.host),
  ],
  renderText: ({ node }) => loginChipLabel(node.attrs.username, node.attrs.host),
  addNodeView: () => ReactNodeViewRenderer(LoginChipView, { as: "span" }),

  markdownTokenName: "docLogin",
  markdownTokenizer: { name: "docLogin", level: "inline", start: (src: string) => src.indexOf("[@"), tokenize: tokenizeLogin },
  parseMarkdown(token, helpers) {
    return helpers.createNode("docLogin", { id: String(token.id ?? ""), username: String(token.username ?? ""), host: String(token.host ?? "") });
  },
  renderMarkdown(node) {
    const { id, username, host } = node.attrs ?? {};
    // The separator is always written, so a name containing " · " cannot be mistaken for name plus host.
    return `[@${escapeLabel(String(username ?? ""))}${SEPARATOR}${escapeLabel(String(host ?? ""))}](login:${encodeId(String(id ?? ""))})`;
  },
});
