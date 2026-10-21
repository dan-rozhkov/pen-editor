import { Extension, ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { SlashCommandKey } from "./slashKey";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { getCachedDocTemplates } from "@/lib/docs/docTemplates";
import { templateSlashItems } from "../templateInsert";
import { isInPropertyCell } from "../extensions/docProperties";
import { SLASH_ITEMS, filterSlashItems, runSlashItem, slashItemsAt, type SlashItem } from "./slashItems";

export { SlashCommandKey };

/** "/" at the start of a block or after a space opens the block menu. Not inside code. */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: SlashCommandKey,
        char: "/",
        allowedPrefixes: [" "],
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          // A property key/value is one line of inline text: a block inserted there would split the list.
          return !isInPropertyCell($from);
        },
        items: ({ query, editor }) =>
          filterSlashItems(query, slashItemsAt(editor.state.selection.$from, [...SLASH_ITEMS, ...templateSlashItems(getCachedDocTemplates())])),
        command: ({ editor, range, props }) => runSlashItem(editor, range, props),
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle> | null = null;
          let unmount: (() => void) | undefined;
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              renderer.element.style.zIndex = "10050";
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => renderer?.updateProps(props),
            onKeyDown: (props) => {
              if (props.event.key === "Escape") return false; // the plugin dismisses itself
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              unmount?.();
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
