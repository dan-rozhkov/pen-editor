import { TextSelection } from "@tiptap/pm/state";
import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockView } from "./CodeBlockView";

export const MERMAID_SAMPLE = "flowchart LR\n  A[Start] --> B[End]";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docMermaid: {
      /** Insert a ```mermaid block with a small sample and put the cursor inside it. */
      insertMermaid: () => ReturnType;
    };
  }
}

/** codeBlock with a React node view: ```mermaid renders as a diagram, every other language as a plain block. */
export const DocCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  addCommands() {
    return {
      ...this.parent?.(),
      insertMermaid:
        () =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes[this.name];
          const before = state.selection.from;
          if (dispatch) {
            tr.replaceSelectionWith(type.create({ language: "mermaid" }, state.schema.text(MERMAID_SAMPLE)));
            let start = -1;
            tr.doc.nodesBetween(Math.max(0, before - 1), tr.doc.content.size, (node, pos) => {
              if (start === -1 && node.type === type && node.attrs.language === "mermaid" && node.textContent === MERMAID_SAMPLE) start = pos;
              return start === -1;
            });
            if (start !== -1) tr.setSelection(TextSelection.create(tr.doc, start + 1 + MERMAID_SAMPLE.length));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});
