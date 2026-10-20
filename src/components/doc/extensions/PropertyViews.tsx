import type { ComponentType } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ArrowUpRightIcon, CalendarBlankIcon, HashIcon, ListBulletsIcon, TextAlignLeftIcon, TextTIcon, type IconProps } from "@phosphor-icons/react";
import { addPropertyRow, inferIconKind, valueFacts, type PropertyIconKind } from "./docProperties";

const ICONS: Record<PropertyIconKind, ComponentType<IconProps>> = {
  text: TextTIcon,
  date: CalendarBlankIcon,
  link: ArrowUpRightIcon,
  tags: ListBulletsIcon,
  number: HashIcon,
  lines: TextAlignLeftIcon,
};

/** One field: a muted icon (inferred from the value, never stored) and a key/value pair laid out by CSS. */
export function PropertyRowView({ node }: NodeViewProps) {
  const kind = inferIconKind(valueFacts(node.lastChild));
  const Icon = ICONS[kind];
  return (
    <NodeViewWrapper className="doc-property-row" data-type="property-row" data-icon={kind}>
      <span className="doc-property-icon" contentEditable={false} aria-hidden="true">
        <Icon size={16} />
      </span>
      <NodeViewContent className="doc-property-cells" />
    </NodeViewWrapper>
  );
}

/** The rows plus a muted "+ Add a property" line (CSS hides it while the editor is read-only). */
export function PropertyListView({ editor, getPos }: NodeViewProps) {
  return (
    <NodeViewWrapper className="doc-property-list" data-type="property-list">
      <NodeViewContent className="doc-property-rows" />
      <button
        type="button"
        className="doc-property-add"
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const pos = getPos();
          if (pos !== undefined) addPropertyRow(editor, pos);
        }}
      >
        + Add a property
      </button>
    </NodeViewWrapper>
  );
}
