import { useState } from "react";
import { useTextStyleStore } from "../store/textStyleStore";
import { generateTextStyleId } from "../types/textStyle";
import type { TextStyle, TextStylePropertyKey } from "../types/textStyle";
import { useLeftSidebarStore } from "../store/leftSidebarStore";
import { EditableText } from "./ui/EditableText";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import { PlusIcon, TextAaIcon, TrashIcon, ArrowLineLeftIcon } from "@phosphor-icons/react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { IconButton } from "./ui/IconButton";
import { PanelEmptyState } from "./PanelEmptyState";

function commitNumberOrClear(
  raw: string,
  onChange: (value: number | undefined) => void,
) {
  if (raw === "") {
    onChange(undefined);
    return;
  }
  const parsed = Number(raw);
  if (!Number.isNaN(parsed)) onChange(parsed);
}

function TextStyleRow({ style }: { style: TextStyle }) {
  const updateTextStyle = useTextStyleStore((s) => s.updateTextStyle);
  const deleteTextStyle = useTextStyleStore((s) => s.deleteTextStyle);
  const [hovered, setHovered] = useState(false);

  const set = <K extends TextStylePropertyKey | "name">(
    key: K,
    value: TextStyle[K],
  ) => updateTextStyle(style.id, { [key]: value });

  return (
    <TableRow
      className="border-border-light hover:bg-secondary/50"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TableCell className="py-2 px-3">
        <EditableText value={style.name} onCommit={(v) => set("name", v)} allowEmpty />
      </TableCell>
      <TableCell className="py-2 px-3 border-l border-border-light">
        <EditableText
          value={style.fontFamily ?? ""}
          onCommit={(v) => set("fontFamily", v || undefined)}
          placeholder="Arial"
          allowEmpty
        />
      </TableCell>
      <TableCell className="py-2 px-3 border-l border-border-light">
        <EditableText
          value={style.fontSize !== undefined ? String(style.fontSize) : ""}
          inputType="number"
          onCommit={(v) => commitNumberOrClear(v, (n) => set("fontSize", n))}
          placeholder="16"
          allowEmpty
        />
      </TableCell>
      <TableCell className="py-2 px-3 border-l border-border-light">
        <EditableText
          value={style.fontWeight ?? ""}
          onCommit={(v) => set("fontWeight", v || undefined)}
          placeholder="normal"
          allowEmpty
        />
      </TableCell>
      <TableCell className="py-2 px-3 border-l border-border-light">
        <EditableText
          value={style.lineHeight !== undefined ? String(style.lineHeight) : ""}
          inputType="number"
          onCommit={(v) => commitNumberOrClear(v, (n) => set("lineHeight", n))}
          placeholder="1.2"
          allowEmpty
        />
      </TableCell>
      <TableCell className="py-2 px-3 border-l border-border-light">
        <EditableText
          value={style.letterSpacing !== undefined ? String(style.letterSpacing) : ""}
          inputType="number"
          onCommit={(v) => commitNumberOrClear(v, (n) => set("letterSpacing", n))}
          placeholder="0"
          allowEmpty
        />
      </TableCell>
      <TableCell className="py-2 px-3 border-l border-border-light">
        {hovered && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-red-400 transition-colors"
                  onClick={() => deleteTextStyle(style.id)}
                  aria-label="Delete text style"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Delete text style</TooltipContent>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Standalone panel body (no Dialog wrapper) rendered inside the left sidebar's
 * "Text styles" section — mirrors `ChatPanelContent`'s shape (self-contained
 * header incl. expand/collapse, body below).
 */
export function TextStylesPanelContent() {
  const textStyles = useTextStyleStore((s) => s.textStyles);
  const addTextStyle = useTextStyleStore((s) => s.addTextStyle);
  const isExpanded = useLeftSidebarStore((s) => s.isExpanded);
  const toggleExpanded = useLeftSidebarStore((s) => s.toggleExpanded);

  const handleAdd = () => {
    const newStyle: TextStyle = {
      id: generateTextStyleId(),
      name: `Style ${textStyles.length + 1}`,
      fontFamily: "Arial",
      fontSize: 16,
      fontWeight: "normal",
      lineHeight: 1.2,
      letterSpacing: 0,
      textTransform: "none",
    };
    addTextStyle(newStyle);
  };

  return (
    <div className="w-full h-full bg-surface-panel flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">
          Text styles
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="p-1 rounded hover:bg-secondary transition-colors text-text-muted hover:text-text-primary"
                aria-label="Add text style"
                onClick={handleAdd}
              >
                <PlusIcon className="size-4" />
              </button>
            }
          />
          <TooltipContent>Add text style</TooltipContent>
        </Tooltip>
        <IconButton
          variant="ghost"
          size="icon-sm"
          onClick={toggleExpanded}
          tooltip={isExpanded ? "Collapse panel" : "Expand panel"}
        >
          <ArrowLineLeftIcon
            size={16}
            className={isExpanded ? "" : "rotate-180"}
          />
        </IconButton>
      </div>

      <div className="flex-1 overflow-auto">
        {textStyles.length === 0 ? (
          <PanelEmptyState icon={<TextAaIcon size={28} weight="light" />}>
            No text styles yet
          </PanelEmptyState>
        ) : (
        <Table className="border-collapse select-none table-fixed min-w-[720px]">
          <TableHeader>
            <TableRow className="border-border-light bg-surface-panel sticky top-0 hover:bg-surface-panel">
              <TableHead className="w-[21%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto">
                Name
              </TableHead>
              <TableHead className="w-[17%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Font
              </TableHead>
              <TableHead className="w-[11%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Size
              </TableHead>
              <TableHead className="w-[13%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Weight
              </TableHead>
              <TableHead className="w-[13%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Line height
              </TableHead>
              <TableHead className="w-[17%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Letter spacing
              </TableHead>
              <TableHead className="w-[7%] h-auto border-l border-border-light" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {textStyles.map((s) => <TextStyleRow key={s.id} style={s} />)}
          </TableBody>
        </Table>
        )}
      </div>
    </div>
  );
}
