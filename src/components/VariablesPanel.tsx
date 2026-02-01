import { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { useVariableStore } from "../store/variableStore";
import { generateVariableId, getVariableValue } from "../types/variable";
import type { Variable, VariableType, ThemeName } from "../types/variable";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { CustomColorPicker } from "./ui/ColorPicker";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";

// Type badge labels and colors
const typeBadge: Record<VariableType, { label: string; className: string }> = {
  color: { label: "C", className: "bg-purple-500/20 text-purple-400" },
  number: { label: "#", className: "bg-blue-500/20 text-blue-400" },
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

// Inline editable text cell
function EditableCell({
  value,
  onCommit,
  className,
  inputType = "text",
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  inputType?: "text" | "number";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onCommit(trimmed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={clsx(
          "w-full bg-surface-elevated rounded px-2 py-1 text-xs text-text-primary outline-none",
          className,
        )}
      />
    );
  }

  return (
    <span
      className={clsx(
        "text-xs text-text-secondary truncate cursor-text hover:text-text-primary block px-2 py-1 rounded hover:bg-surface-elevated",
        className,
      )}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || "(empty)"}
    </span>
  );
}

// Color cell with swatch + hex value
function ColorCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <CustomColorPicker value={value} onChange={onChange} swatchSize="sm" />
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
    <EditableCell
      value={value}
      onCommit={(v) => updateVariableThemeValue(variable.id, theme, v)}
      inputType={variable.type === "number" ? "number" : "text"}
    />
  );
}

// Variable row in the table
function VariableRow({ variable }: { variable: Variable }) {
  const updateVariable = useVariableStore((s) => s.updateVariable);
  const deleteVariable = useVariableStore((s) => s.deleteVariable);
  const [hovered, setHovered] = useState(false);
  const badge = typeBadge[variable.type];

  return (
    <tr
      className="border-b border-border-light hover:bg-surface-elevated/50 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Name */}
      <td className="py-1 px-1">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0",
              badge.className,
            )}
          >
            {badge.label}
          </span>
          <EditableCell
            value={variable.name}
            onCommit={(name) => updateVariable(variable.id, { name })}
          />
        </div>
      </td>
      {/* Light */}
      <td className="py-1 px-1 border-l border-border-light">
        <ValueCell variable={variable} theme="light" />
      </td>
      {/* Dark */}
      <td className="py-1 px-1 border-l border-border-light">
        <ValueCell variable={variable} theme="dark" />
      </td>
      {/* Actions */}
      <td className="py-1 px-1 w-8 border-l border-border-light">
        {hovered && (
          <button
            className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-red-400 transition-colors"
            onClick={() => deleteVariable(variable.id)}
            title="Delete variable"
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

interface VariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      <DropdownMenuTrigger>{children}</DropdownMenuTrigger>
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

export function VariablesDialog({ open, onOpenChange }: VariablesDialogProps) {
  const variables = useVariableStore((s) => s.variables);
  const addVariable = useVariableStore((s) => s.addVariable);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0"
        showCloseButton={false}
        overlayClassName="backdrop-blur-none bg-black/40"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <DialogTitle>Variables</DialogTitle>
          <AddVariableDropdown onAdd={handleAddVariable}>
            <button
              className="p-1 rounded hover:bg-surface-elevated transition-colors text-text-muted hover:text-text-primary"
              title="Add variable"
            >
              <PlusIcon className="size-4" />
            </button>
          </AddVariableDropdown>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse select-none">
            <thead>
              <tr className="border-b border-border-light bg-surface-panel sticky top-0">
                <th className="text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide px-3 py-2">
                  Name
                </th>
                <th className="text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide px-3 py-2 border-l border-border-light">
                  Light
                </th>
                <th className="text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide px-3 py-2 border-l border-border-light">
                  Dark
                </th>
                <th className="w-8 border-l border-border-light" />
              </tr>
            </thead>
            <tbody>
              {variables.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-center text-text-disabled text-xs py-12"
                  >
                    No variables yet
                  </td>
                </tr>
              ) : (
                variables.map((v) => <VariableRow key={v.id} variable={v} />)
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border-t border-border-light px-4 py-3">
          <AddVariableDropdown onAdd={handleAddVariable} side="top">
            <button className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors">
              <PlusIcon className="size-4" weight="light" />
              Create variable
            </button>
          </AddVariableDropdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}
