import { useState, type ComponentType } from "react";
import { NodeViewContent, NodeViewWrapper, useEditorState, type NodeViewProps } from "@tiptap/react";
import { ArrowUpRightIcon, CalendarBlankIcon, HashIcon, ListBulletsIcon, TextAlignLeftIcon, TextTIcon, type IconProps } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { POPOVER_SURFACE } from "../ui/menuSurface";
import { PropertyValueMenu } from "./PropertyValueMenu";
import "./propertyPicker.css";
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
export function PropertyRowView({ node, editor, getPos }: NodeViewProps) {
  const facts = valueFacts(node.lastChild);
  const kind = inferIconKind(facts);
  const Icon = ICONS[kind];
  const [open, setOpen] = useState(false);
  const editable = useEditorState({ editor, selector: (state) => state.editor.isEditable });
  return (
    <NodeViewWrapper className="doc-property-row" data-type="property-row" data-icon={kind}>
      {editable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className="doc-property-icon doc-property-icon-button"
            contentEditable={false}
            aria-label="Change value type"
            aria-haspopup="menu"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Icon size={16} />
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={6}
            finalFocus={false}
            className={cn(POPOVER_SURFACE, "w-60 p-1.5")}
          >
            <PropertyValueMenu
              editor={editor}
              getRowPos={getPos}
              keyText={node.firstChild?.textContent ?? ""}
              valueText={facts.text}
              currentTag={facts.onlyTags ? { text: facts.text.trim() } : null}
              onDone={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="doc-property-icon" contentEditable={false} aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
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
