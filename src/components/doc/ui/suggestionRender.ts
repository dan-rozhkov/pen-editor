import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { ComponentType, RefAttributes } from "react";
import type { SuggestionMenuHandle } from "./useListNav";

/** The `render` option of a doc suggestion: a React menu mounted under the caret, keys routed to its handle. */
export function reactSuggestionRender<I, S = I>(Menu: ComponentType<SuggestionProps<I, S> & RefAttributes<SuggestionMenuHandle>>): NonNullable<SuggestionOptions<I, S>["render"]> {
  return () => {
    let renderer: ReactRenderer<SuggestionMenuHandle> | null = null;
    let unmount: (() => void) | undefined;
    return {
      onStart: (props) => {
        renderer = new ReactRenderer(Menu, { props, editor: props.editor });
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
  };
}
