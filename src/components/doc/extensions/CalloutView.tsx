import { useCallback, useState, type ComponentType } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { InfoIcon, LightbulbIcon, MegaphoneIcon, WarningIcon, WarningOctagonIcon, type IconProps } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MENU_HOVER, POPOVER_SURFACE } from "../ui/menuSurface";
import { useTransientPopover } from "./useTransientPopover";
import { CALLOUT_KINDS, isCalloutKind, type CalloutKind } from "./docCallout";

const ICONS: Record<CalloutKind, ComponentType<IconProps>> = {
  note: InfoIcon,
  tip: LightbulbIcon,
  important: MegaphoneIcon,
  warning: WarningIcon,
  caution: WarningOctagonIcon,
};

const LABELS: Record<CalloutKind, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

/** A tinted box: the icon button (left) opens a small menu to change the kind; the body is ordinary block content. */
export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useTransientPopover(open, close, editor);
  const kind: CalloutKind = isCalloutKind(node.attrs.kind) ? node.attrs.kind : "note";
  const Icon = ICONS[kind];
  return (
    <NodeViewWrapper className="doc-callout" data-type="callout" data-kind={kind}>
      <div className="doc-callout-side" contentEditable={false}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className="doc-callout-icon"
            aria-label={`${LABELS[kind]} callout, change type`}
            aria-haspopup="menu"
            disabled={!editor.isEditable}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Icon size={18} weight="fill" />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" sideOffset={4} finalFocus={false} className={cn(POPOVER_SURFACE, "max-h-[min(24rem,var(--available-height))] w-40 overflow-y-auto p-1")}>
            <div role="menu" aria-label="Callout type" className="doc-palette flex flex-col gap-0.5" onMouseDown={(event) => event.preventDefault()}>
              {CALLOUT_KINDS.map((option) => {
                const OptionIcon = ICONS[option];
                return (
                  <button
                    key={option}
                    type="button"
                    role="menuitem"
                    className={cn(MENU_HOVER, "doc-callout-option text-menu-foreground flex min-h-8 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13px] leading-5")}
                    data-kind={option}
                    onClick={() => {
                      updateAttributes({ kind: option });
                      setOpen(false);
                    }}
                  >
                    <OptionIcon size={16} weight="fill" />
                    {LABELS[option]}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <NodeViewContent className="doc-callout-body" />
    </NodeViewWrapper>
  );
}
