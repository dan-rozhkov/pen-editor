import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { handleLinkClick, openExternalLink, type LinkActions } from "@/lib/docs/docLinkActions";

export interface DocLinkClickOptions {
  /** Read at click time, so a re-render can swap the handlers without rebuilding the editor. */
  getActions: () => Pick<LinkActions, "openDoc" | "focusNode"> | null;
}

/**
 * A plain click on a link: `/doc?id=` switches the document, `/app?node=` shows the frame on
 * the canvas, anything else opens in a new tab (what Link's own openOnClick did).
 */
export const DocLinkClick = Extension.create<DocLinkClickOptions>({
  name: "docLinkClick",
  addOptions() {
    return { getActions: () => null };
  },
  addProseMirrorPlugins() {
    const getActions = this.options.getActions;
    return [
      new Plugin({
        key: new PluginKey("docLinkClick"),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || !view.editable) return false;
            const target = event.target instanceof Element ? event.target : null;
            const anchor = target?.closest("a");
            const href = anchor?.getAttribute("href");
            if (!anchor || !href || !view.dom.contains(anchor)) return false;
            const actions = getActions();
            handleLinkClick(href, {
              openDoc: (id) => actions?.openDoc(id),
              focusNode: (id) => actions?.focusNode(id),
              openExternal: openExternalLink,
            });
            return true;
          },
        },
      }),
    ];
  },
});
