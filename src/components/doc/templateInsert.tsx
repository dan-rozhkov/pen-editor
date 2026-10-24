import { FileTextIcon } from "@/components/icons";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { DocTemplate } from "@/lib/docs/docTemplates";
import type { SlashItem } from "./slash/slashItems";

/** Fired on the editor DOM after a template body went in; `detail.title` is the template's H1. */
export const TEMPLATE_INSERTED_EVENT = "doc-template-inserted";

export const TEMPLATES_GROUP = "Templates";

/** The template body as editor nodes, parsed with the editor's own markdown parser. */
export function templateNodes(editor: Editor, template: DocTemplate): JSONContent[] {
  return editor.markdown?.parse(template.markdown.trim()).content ?? [];
}

/** Inserts the body at the cursor (as one undo step) and tells the page which title the template suggests. */
export function insertTemplate(editor: Editor, chain: ReturnType<Editor["chain"]>, template: DocTemplate): void {
  const nodes = templateNodes(editor, template);
  if (nodes.length > 0) chain.insertContent(nodes).run();
  else chain.run();
  editor.view.dom.dispatchEvent(new CustomEvent(TEMPLATE_INSERTED_EVENT, { detail: { title: template.title } }));
}

export function templateSlashItems(templates: DocTemplate[] | null): SlashItem[] {
  return (templates ?? []).map((template) => ({
    id: `template-${template.id}`,
    title: template.label,
    hint: template.description,
    keywords: ["template", ...template.label.toLowerCase().split(/\s+/)],
    icon: <FileTextIcon />,
    group: TEMPLATES_GROUP,
    hideInTable: true,
    run: (editor, chain) => insertTemplate(editor, chain, template),
  }));
}
