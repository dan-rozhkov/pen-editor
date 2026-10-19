import { Extension, ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { filterSlashItems, runSlashItem, type SlashItem } from "./slashItems";

export const SlashCommandKey = new PluginKey("slashCommand");

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
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterSlashItems(query),
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
