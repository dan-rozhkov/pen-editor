import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { isLibraryOwned, libraryOwnedMessage } from "@/lib/designSystem/ownership";
import { useVariableStore } from "../store/variableStore";
import { generateVariableId, THEME_COLLECTION_ID } from "../types/variable";
import type {
  Variable,
  VariableCollection,
  VariableMode,
  VariableType,
} from "../types/variable";
import {
  collectionIdOf,
  getVariableIndex,
  modeValuesOf,
  resolveVariable,
} from "../lib/variables";
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
import {
  PlusCircleIcon,
  PlusIcon,
  TrashIcon,
  ArrowLineLeftIcon,
  MagnifyingGlassIcon,
  LinkSimpleIcon,
  LinkBreakIcon,
  CaretRightIcon,
  DotsThreeIcon,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { IconButton } from "./ui/IconButton";
import { Input } from "./ui/input";
import { PanelEmptyState } from "./PanelEmptyState";
import { AliasPicker } from "./AliasPicker";
import { VariableDetails } from "./VariableDetails";

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

const NAME_COL_PX = 200;
const MODE_COL_PX = 170;
const ACTIONS_COL_PX = 72;

const headClass =
  "text-[11px] font-semibold text-text-muted uppercase tracking-wide px-3 py-2.5 h-auto border-l border-border-light";

const iconButtonClass =
  "p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors focus-visible:ring-1 focus-visible:ring-accent-light outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

// Color cell with swatch + hex value
function ColorCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <CustomColorPicker value={value} onChange={onChange} />
      <span className="text-xs text-text-secondary font-mono truncate">
        {value.replace("#", "").toUpperCase()}
      </span>
    </div>
  );
}

// Value cell for one (variable, mode): a literal editor + link button, or an alias chip
function ValueCell({
  variable,
  collection,
  mode,
}: {
  variable: Variable;
  collection: VariableCollection;
  mode: VariableMode;
}) {
  const variables = useVariableStore((s) => s.variables);
  const collections = useVariableStore((s) => s.collections);
  const setVariableModeValue = useVariableStore((s) => s.setVariableModeValue);
  const entry = modeValuesOf(variable)[mode.id];

  if (entry !== undefined && typeof entry !== "string") {
    const index = getVariableIndex(variables, collections);
    const target = index.byId.get(entry.alias);
    const resolved = resolveVariable(index, variable.id, {
      [collection.id]: mode.id,
    });
    const resolvedValue = resolved.ok ? resolved.value : null;
    const detach = () =>
      setVariableModeValue(variable.id, mode.id, resolvedValue ?? variable.value);
    return (
      <div className="flex items-center gap-1 min-w-0">
        <AliasPicker
          variable={variable}
          modeId={mode.id}
          trigger={
            <button
              type="button"
              aria-label={`Alias of ${variable.name} in ${mode.name}: ${target?.name ?? "missing variable"}. Change`}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-secondary px-1.5 py-1 text-xs text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
            >
              <LinkSimpleIcon aria-hidden className="size-3 shrink-0 text-text-muted" />
              {variable.type === "color" && resolvedValue && (
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm border border-border-light"
                  style={{ background: resolvedValue }}
                />
              )}
              <span className="truncate">{target?.name ?? "Missing variable"}</span>
              {variable.type !== "color" && resolvedValue !== null && (
                <span className="truncate text-text-muted">{resolvedValue}</span>
              )}
            </button>
          }
        />
        <button
          type="button"
          className={iconButtonClass}
          aria-label={`Detach alias of ${variable.name} in ${mode.name}`}
          onClick={detach}
        >
          <LinkBreakIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  const value = entry ?? variable.value;
  const commit = (v: string) => setVariableModeValue(variable.id, mode.id, v);
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className="min-w-0 flex-1 overflow-hidden">
        {variable.type === "color" ? (
          <ColorCell value={value} onChange={commit} />
        ) : (
          <EditableText
            value={value}
            onCommit={commit}
            inputType={variable.type === "number" ? "number" : "text"}
            allowEmpty
          />
        )}
      </div>
      <AliasPicker
        variable={variable}
        modeId={mode.id}
        trigger={
          <button
            type="button"
            className={iconButtonClass}
            aria-label={`Link ${variable.name} in ${mode.name} to a variable`}
          >
            <LinkSimpleIcon className="size-3.5" />
          </button>
        }
      />
    </div>
  );
}

// Variable row in the table (+ optional details row)
function VariableRow({
  variable,
  collection,
}: {
  variable: Variable;
  collection: VariableCollection;
}) {
  const renameVariable = useVariableStore((s) => s.renameVariable);
  const deleteVariable = useVariableStore((s) => s.deleteVariable);
  const [expanded, setExpanded] = useState(false);
  // renameVariable refuses a colliding name; the draft is discarded and the old
  // name stays, so the reason must be said somewhere.
  // The error is tied to the variable list it was raised against: any later
  // change (the colliding variable renamed or deleted, this one renamed) makes
  // it stale, so it stops showing.
  const variables = useVariableStore((s) => s.variables);
  const [renameFailure, setRenameFailure] = useState<{
    message: string;
    variables: Variable[];
  } | null>(null);
  const renameError =
    renameFailure && renameFailure.variables === variables ? renameFailure.message : null;
  const badge = typeBadge[variable.type];
  // Copies of a linked library's tokens: shown, never edited here.
  const owned = isLibraryOwned(variable);

  return (
    <Fragment>
      <TableRow className="group border-border-light hover:bg-secondary/50">
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
            <div className="min-w-0 flex-1" inert={owned}>
              <EditableText
                value={variable.name}
                onCommit={(name) => {
                  const result = renameVariable(variable.id, name);
                  setRenameFailure(
                    "error" in result
                      ? { message: result.error, variables: useVariableStore.getState().variables }
                      : null,
                  );
                }}
                allowEmpty
              />
              {renameError && (
                <div role="status" className="px-2 text-[10px] text-red-400">
                  {renameError}
                </div>
              )}
            </div>
            {owned && (
              <Badge variant="outline" title={libraryOwnedMessage("variable", variable.name, variable.libraryId as string)}>
                Library
              </Badge>
            )}
            {variable.deprecated && (
              <Badge variant="outline" title={variable.deprecated.note}>
                Deprecated
              </Badge>
            )}
          </div>
        </TableCell>
        {/* One cell per mode */}
        {collection.modes.map((mode) => (
          <TableCell key={mode.id} inert={owned} className="py-2 px-3 border-l border-border-light">
            <ValueCell variable={variable} collection={collection} mode={mode} />
          </TableCell>
        ))}
        {/* Actions */}
        <TableCell className="py-2 px-2 border-l border-border-light">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={iconButtonClass}
              aria-expanded={expanded}
              aria-label={`Details of ${variable.name}`}
              onClick={() => setExpanded((e) => !e)}
            >
              <CaretRightIcon
                className={clsx("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
            {!owned && <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className={clsx(
                      iconButtonClass,
                      "hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    )}
                    onClick={() => deleteVariable(variable.id)}
                    aria-label="Delete variable"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Delete variable</TooltipContent>
            </Tooltip>}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-border-light hover:bg-transparent">
          <TableCell colSpan={collection.modes.length + 2} className="p-0 whitespace-normal">
            <VariableDetails variable={variable} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

// Inline text input used to rename a collection or a mode
function RenameInput({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <Input
      aria-label={label}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(draft.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(draft.trim() || null);
        else if (e.key === "Escape") onDone(null);
      }}
      className="h-6 text-[11px]"
    />
  );
}

// Column header of one mode: name, default marker and the mode menu
function ModeHeader({
  collection,
  mode,
}: {
  collection: VariableCollection;
  mode: VariableMode;
}) {
  const renameMode = useVariableStore((s) => s.renameMode);
  const deleteMode = useVariableStore((s) => s.deleteMode);
  const setDefaultMode = useVariableStore((s) => s.setDefaultMode);
  const [renaming, setRenaming] = useState(false);
  const isDefault = collection.defaultModeId === mode.id;
  // The Theme collection's Light/Dark are structural: the store refuses to change them.
  const structural = collection.id === THEME_COLLECTION_ID;

  if (renaming) {
    return (
      <RenameInput
        label="Mode name"
        initial={mode.name}
        onDone={(name) => {
          if (name && name !== mode.name) renameMode(collection.id, mode.id, name);
          setRenaming(false);
        }}
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="truncate">{mode.name}</span>
      {isDefault && (
        <Badge variant="secondary" aria-label="Default mode">
          Default
        </Badge>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Mode menu: ${mode.name}`}
          className={clsx(iconButtonClass, "ml-auto")}
        >
          <DotsThreeIcon className="size-3.5" weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[140px] bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1"
        >
          <DropdownMenuItem
            className="text-xs cursor-pointer"
            onClick={() => setRenaming(true)}
          >
            Rename mode
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs cursor-pointer"
            disabled={isDefault || structural}
            onClick={() => setDefaultMode(collection.id, mode.id)}
          >
            Set as default
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs cursor-pointer"
            disabled={isDefault || structural || collection.modes.length <= 1}
            onClick={() => deleteMode(collection.id, mode.id)}
          >
            Delete mode
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  const collections = useVariableStore((s) => s.collections);
  const addVariable = useVariableStore((s) => s.addVariable);
  const addCollection = useVariableStore((s) => s.addCollection);
  const renameCollection = useVariableStore((s) => s.renameCollection);
  const deleteCollection = useVariableStore((s) => s.deleteCollection);
  const addMode = useVariableStore((s) => s.addMode);
  const isExpanded = useLeftSidebarStore((s) => s.isExpanded);
  const toggleExpanded = useLeftSidebarStore((s) => s.toggleExpanded);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(THEME_COLLECTION_ID);
  const [renamingCollection, setRenamingCollection] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The selected collection may have been deleted (or undone away): fall back to the first.
  const active = collections.find((c) => c.id === selectedId) ?? collections[0];

  const collectionVariables = useMemo(
    () => (active ? variables.filter((v) => collectionIdOf(v) === active.id) : []),
    [variables, active],
  );
  const filteredVariables = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return collectionVariables;

    return collectionVariables.filter((variable) =>
      variable.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [searchQuery, collectionVariables]);

  const handleAddVariable = (type: VariableType) => {
    if (!active) return;
    const defaultVal = defaultValues[type];
    const count = variables.filter((v) => v.type === type).length;
    const valuesByMode = Object.fromEntries(active.modes.map((m) => [m.id, defaultVal]));
    const newVar: Variable = {
      id: generateVariableId(),
      name: `${defaultNames[type]} ${count + 1}`,
      type,
      collectionId: active.id,
      valuesByMode,
      value: defaultVal,
      ...(active.id === THEME_COLLECTION_ID
        ? { themeValues: { light: defaultVal, dark: defaultVal } }
        : {}),
    };
    if (!addVariable(newVar)) {
      setNotice(
        isLibraryOwned(active)
          ? libraryOwnedMessage("collection", active.name, active.libraryId as string)
          : "That name is already used by a library token.",
      );
    }
  };

  /** Shows why an edit of a library-owned collection was refused; true when it was. */
  const refuseIfLibraryOwned = (): boolean => {
    if (!active || !isLibraryOwned(active)) return false;
    setNotice(libraryOwnedMessage("collection", active.name, active.libraryId as string));
    return true;
  };

  const handleAddCollection = () => {
    setNotice(null);
    setSelectedId(addCollection(`Collection ${collections.length + 1}`));
  };

  const handleDeleteCollection = () => {
    if (!active || refuseIfLibraryOwned()) return;
    if (!deleteCollection(active.id)) {
      setNotice(
        active.id === THEME_COLLECTION_ID
          ? "The Theme collection cannot be deleted."
          : "Delete or move the variables out of this collection first.",
      );
      return;
    }
    setNotice(null);
  };

  const themeModesFixed = active?.id === THEME_COLLECTION_ID;
  const addModeHint = themeModesFixed ? "Theme modes are fixed (Light and Dark)" : "Add mode";

  const handleAddMode = () => {
    if (active && !themeModesFixed && !refuseIfLibraryOwned()) addMode(active.id, `Mode ${active.modes.length + 1}`);
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

      {/* Collections */}
      {active && (
        <div className="flex items-center gap-1 px-3 pt-2 shrink-0">
          {renamingCollection ? (
            <RenameInput
              label="Collection name"
              initial={active.name}
              onDone={(name) => {
                if (name && name !== active.name && !refuseIfLibraryOwned()) renameCollection(active.id, name);
                setRenamingCollection(false);
              }}
            />
          ) : (
            <>
              <Tabs
                value={active.id}
                onValueChange={(id) => {
                  setSelectedId(String(id));
                  setNotice(null);
                }}
                className="min-w-0 gap-0"
              >
                <TabsList
                  variant="line"
                  aria-label="Collections"
                  className="max-w-full justify-start overflow-x-auto"
                >
                  {collections.map((c) => (
                    <TabsTrigger key={c.id} value={c.id} className="flex-none">
                      {c.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <button
                type="button"
                className={iconButtonClass}
                aria-label="Add collection"
                onClick={handleAddCollection}
              >
                <PlusIcon className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Collection menu: ${active.name}`}
                  className={iconButtonClass}
                >
                  <DotsThreeIcon className="size-3.5" weight="bold" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[140px] bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1"
                >
                  <DropdownMenuItem
                    className="text-xs cursor-pointer"
                    onClick={() => setRenamingCollection(true)}
                  >
                    Rename collection
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs cursor-pointer"
                    onClick={handleDeleteCollection}
                  >
                    Delete collection
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="px-4 pt-1 text-xs text-text-muted shrink-0">
          {notice}
        </p>
      )}

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
        {variables.length === 0 && collections.length === 1 ? (
          <PanelEmptyState icon={<PlusCircleIcon size={28} weight="light" />}>
            No variables yet
          </PanelEmptyState>
        ) : (
          <>
        <Table
          className="border-collapse select-none table-fixed"
          style={{
            minWidth: NAME_COL_PX + MODE_COL_PX * (active?.modes.length ?? 0) + ACTIONS_COL_PX,
          }}
        >
          <TableHeader>
            <TableRow className="border-border-light bg-surface-panel sticky top-0 hover:bg-surface-panel">
              <TableHead
                style={{ width: NAME_COL_PX }}
                className={clsx(headClass, "border-l-0")}
              >
                Name
              </TableHead>
              {active?.modes.map((mode) => (
                <TableHead key={mode.id} style={{ width: MODE_COL_PX }} className={headClass}>
                  <ModeHeader collection={active} mode={mode} />
                </TableHead>
              ))}
              <TableHead style={{ width: ACTIONS_COL_PX }} className={headClass}>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label="Add mode"
                  title={addModeHint}
                  disabled={themeModesFixed}
                  onClick={handleAddMode}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active &&
              filteredVariables.map((v) => (
                <VariableRow key={v.id} variable={v} collection={active} />
              ))}
          </TableBody>
        </Table>
        {filteredVariables.length === 0 && (
          <PanelEmptyState icon={null}>
            {collectionVariables.length === 0
              ? "No variables in this collection."
              : "No variables found."}
          </PanelEmptyState>
        )}
          </>
        )}
      </div>
    </div>
  );
}
