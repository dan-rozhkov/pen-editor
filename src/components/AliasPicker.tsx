import { useMemo, useState, type ReactElement } from "react";
import clsx from "clsx";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useVariableStore } from "../store/variableStore";
import type { ModeId, Variable } from "../types/variable";
import { collectionIdOf, getVariableIndex, wouldCreateCycle } from "../lib/variables";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Input } from "./ui/input";

/**
 * Popover that points one mode cell of `variable` at another variable.
 * Lists variables of the same type from every collection, grouped by
 * collection; targets that would close an alias loop are shown but disabled
 * with the reason.
 */
export function AliasPicker({
  variable,
  modeId,
  trigger,
}: {
  variable: Variable;
  modeId: ModeId;
  /** The element that opens the picker (receives the trigger props). */
  trigger: ReactElement;
}) {
  const variables = useVariableStore((s) => s.variables);
  const collections = useVariableStore((s) => s.collections);
  const setVariableModeValue = useVariableStore((s) => s.setVariableModeValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    if (!open) return [];
    const index = getVariableIndex(variables, collections);
    const q = query.trim().toLocaleLowerCase();
    return collections
      .map((collection) => ({
        collection,
        items: variables
          .filter(
            (v) =>
              v.type === variable.type &&
              collectionIdOf(v) === collection.id &&
              (!q || v.name.toLocaleLowerCase().includes(q)),
          )
          .map((v) => ({ v, blocked: wouldCreateCycle(index, variable.id, v.id) })),
      }))
      .filter((g) => g.items.length > 0);
  }, [open, query, variables, collections, variable.id, variable.type]);

  const pick = (targetId: string) => {
    if (setVariableModeValue(variable.id, modeId, { alias: targetId })) {
      setOpen(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent side="bottom" align="start" className="w-64 p-2 gap-2">
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden
            size={14}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-muted"
          />
          <Input
            aria-label="Search variables to link"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7"
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto flex flex-col gap-2">
          {groups.length === 0 && (
            <p className="px-1 py-2 text-xs text-text-muted">
              No {variable.type} variables to link.
            </p>
          )}
          {groups.map(({ collection, items }) => (
            <div key={collection.id} role="group" aria-label={collection.name}>
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {collection.name}
              </div>
              {items.map(({ v, blocked }) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={blocked}
                  onClick={() => pick(v.id)}
                  className={clsx(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs",
                    blocked
                      ? "cursor-not-allowed text-text-muted opacity-60"
                      : "text-text-primary hover:bg-secondary focus-visible:bg-secondary outline-none",
                  )}
                >
                  <span className="truncate">{v.name}</span>
                  {blocked && (
                    <span className="shrink-0 text-[10px]">Would create a cycle</span>
                  )}
                  {!blocked && v.deprecated && (
                    <span className="shrink-0 text-[10px] text-text-muted">Deprecated</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
