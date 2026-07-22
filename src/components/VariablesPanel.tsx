import { useMemo, useState } from "react";
import clsx from "clsx";
import { useVariableStore } from "../store/variableStore";
import { generateVariableId, getVariableValue } from "../types/variable";
import type { Variable, VariableType, ThemeName } from "../types/variable";
import { useLeftSidebarStore } from "../store/leftSidebarStore";
import { CustomColorPicker } from "./ui/ColorPicker";
import { EditableText } from "./ui/EditableText";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import { PlusCircleIcon, PlusIcon, TrashIcon, ArrowLineLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { IconButton } from "./ui/IconButton";
import { Input } from "./ui/input";
import { PanelEmptyState } from "./PanelEmptyState";

// Type badge labels and colors
const typeBadge: Record<VariableType, { label: string; className: string }> = {
  color: { label: "C", className: "bg-purple-500/20 text-purple-400" },
  number: { label: "#", className: "bg-accent-light/20 text-accent-light" },
  string: { label: "T", className: "bg-green-500/20 text-green-400" },
};

// Default values per variable type
const defaultValues: Record<VariableType, string> = {
  color: "#4a90d9",
  number: "0",
  string: "",
};

const defaultNames: Record<VariableType, string> = {
  color: "Color",
  number: "Number",
  string: "String",
};

// Color cell with swatch + hex value
function ColorCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <CustomColorPicker value={value} onChange={onChange} />
      <span className="text-xs text-text-secondary font-mono truncate">
        {value.replace("#", "").toUpperCase()}
      </span>
    </div>
  );
}

// Value cell dispatcher
function ValueCell({
  variable,
  theme,
}: {
  variable: Variable;
  theme: ThemeName;
}) {
  const updateVariableThemeValue = useVariableStore(
    (s) => s.updateVariableThemeValue,
  );
  const value = getVariableValue(variable, theme);

  if (variable.type === "color") {
    return (
      <ColorCell
        value={value}
        onChange={(v) => updateVariableThemeValue(variable.id, theme, v)}
      />
    );
  }

  return (
    <div className="min-w-0 overflow-hidden">
      <EditableText
        value={value}
        onCommit={(v) => updateVariableThemeValue(variable.id, theme, v)}
        inputType={variable.type === "number" ? "number" : "text"}
        allowEmpty
      />
    </div>
  );
}

// Variable row in the table
function VariableRow({ variable }: { variable: Variable }) {
  const updateVariable = useVariableStore((s) => s.updateVariable);
  const deleteVariable = useVariableStore((s) => s.deleteVariable);
  const [hovered, setHovered] = useState(false);
  const badge = typeBadge[variable.type];

  return (
    <TableRow
      className="border-border-light hover:bg-secondary/50"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Name */}
      <TableCell className="py-2 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={clsx(
              "w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0",
              badge.className,
            )}
          >
            {badge.label}
          </span>
          <div className="min-w-0 flex-1">
            <EditableText
              value={variable.name}
              onCommit={(name) => updateVariable(variable.id, { name })}
              allowEmpty
            />
          </div>
        </div>
      </TableCell>
      {/* Light */}
      <TableCell className="py-2 px-3 border-l border-border-light">
        <ValueCell variable={variable} theme="light" />
      </TableCell>
      {/* Dark */}
      <TableCell className="py-2 px-3 border-l border-border-light">
        <ValueCell variable={variable} theme="dark" />
      </TableCell>
      {/* Actions */}
      <TableCell className="py-2 px-3 border-l border-border-light">
        {hovered && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-red-400 transition-colors"
                  onClick={() => deleteVariable(variable.id)}
                  aria-label="Delete variable"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Delete variable</TooltipContent>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
}

// Dropdown menu items for adding a variable by type
function AddVariableDropdown({
  onAdd,
  side = "bottom",
  children,
}: {
  onAdd: (type: VariableType) => void;
  side?: "bottom" | "top";
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="h-6">{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align="end"
        className="min-w-[120px] bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1"
      >
        {(["color", "number", "string"] as VariableType[]).map((type) => (
          <DropdownMenuItem
            key={type}
            className="flex items-center gap-2 text-xs cursor-pointer"
            onClick={() => onAdd(type)}
          >
            <span
              className={clsx(
                "w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center shrink-0",
                typeBadge[type].className,
              )}
            >
              {typeBadge[type].label}
            </span>
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Standalone panel body (no Dialog wrapper) rendered inside the left sidebar's
 * "Variables" section — mirrors `ChatPanelContent`'s shape (self-contained
 * header incl. expand/collapse, body below).
 */
export function VariablesPanelContent() {
  const variables = useVariableStore((s) => s.variables);
  const addVariable = useVariableStore((s) => s.addVariable);
  const isExpanded = useLeftSidebarStore((s) => s.isExpanded);
  const toggleExpanded = useLeftSidebarStore((s) => s.toggleExpanded);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredVariables = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return variables;

    return variables.filter((variable) =>
      variable.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [searchQuery, variables]);

  const handleAddVariable = (type: VariableType) => {
    const defaultVal = defaultValues[type];
    const count = variables.filter((v) => v.type === type).length;
    const newVar: Variable = {
      id: generateVariableId(),
      name: `${defaultNames[type]} ${count + 1}`,
      type,
      value: defaultVal,
      themeValues: {
        light: defaultVal,
        dark: defaultVal,
      },
    };
    addVariable(newVar);
  };

  return (
    <div className="w-full h-full bg-surface-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">
          Variables
        </span>
        <AddVariableDropdown onAdd={handleAddVariable}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className="p-1 rounded hover:bg-secondary transition-colors text-text-muted hover:text-text-primary"
                  aria-label="Add variable"
                >
                  <PlusIcon className="size-4" />
                </button>
              }
            />
            <TooltipContent>Add variable</TooltipContent>
          </Tooltip>
        </AddVariableDropdown>
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

      <div className="relative px-3 pt-3 pb-2">
        <MagnifyingGlassIcon
          aria-hidden
          size={14}
          className="pointer-events-none absolute top-[26px] left-5 -translate-y-1/2 text-text-muted"
        />
        <Input
          aria-label="Search variables"
          placeholder="Search variables…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-7 pl-7"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {variables.length === 0 ? (
          <PanelEmptyState icon={<PlusCircleIcon size={28} weight="light" />}>
            No variables yet
          </PanelEmptyState>
        ) : filteredVariables.length === 0 ? (
          <PanelEmptyState icon={null}>No variables found.</PanelEmptyState>
        ) : (
        <Table className="border-collapse select-none table-fixed">
          <TableHeader>
            <TableRow className="border-border-light bg-surface-panel sticky top-0 hover:bg-surface-panel">
              <TableHead className="w-[40%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto">
                Name
              </TableHead>
              <TableHead className="w-[25%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Light
              </TableHead>
              <TableHead className="w-[25%] text-[11px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5 h-auto border-l border-border-light">
                Dark
              </TableHead>
              <TableHead className="w-[10%] h-auto border-l border-border-light" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredVariables.map((v) => <VariableRow key={v.id} variable={v} />)}
          </TableBody>
        </Table>
        )}
      </div>
    </div>
  );
}
