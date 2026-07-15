import { useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { CaretRightIcon } from "@phosphor-icons/react";
import { writeTextToClipboard } from "@/utils/clipboard";
import type { InspectValue } from "@/lib/inspect/buildInspectData";

async function copy(label: string, value: string) {
  const ok = await writeTextToClipboard(value);
  if (ok) toast(`Copied ${label}`);
}

function handleActivationKeyDown(onActivate: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      if (e.key === " ") e.preventDefault();
      onActivate();
    }
  };
}

/**
 * A single label/value row in the inspect panel. Whole row is clickable to
 * copy `copyValue ?? value`. Token rows (variable-backed values) expand
 * in-place to show the light/dark values, each independently copyable.
 */
export function InspectRow({ row }: { row: InspectValue }) {
  const [expanded, setExpanded] = useState(false);
  const copyValue = row.copyValue ?? row.value;

  if (!row.token) {
    return (
      <div
        data-testid="inspect-row"
        role="button"
        tabIndex={0}
        className="flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary"
        onClick={() => void copy(row.label, copyValue)}
        onKeyDown={handleActivationKeyDown(() => void copy(row.label, copyValue))}
      >
        <span className="text-text-muted text-xs">{row.label}</span>
        <span className="font-mono text-xs text-text-primary truncate">{row.value}</span>
      </div>
    );
  }

  const token = row.token;

  return (
    <div>
      <div
        data-testid="inspect-row"
        role="button"
        tabIndex={0}
        className="flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={handleActivationKeyDown(() => setExpanded((v) => !v))}
      >
        <span className="text-text-muted text-xs">{row.label}</span>
        <span className="flex items-center gap-1 min-w-0">
          <CaretRightIcon
            size={10}
            weight="bold"
            className={clsx("text-text-muted transition-transform duration-150 shrink-0", expanded && "rotate-90")}
          />
          <span className="font-mono text-xs text-text-primary truncate">{token.name}</span>
        </span>
      </div>
      {expanded && (
        <div className="pl-5 pr-3 pb-1.5 flex flex-col gap-1">
          <div
            data-testid="inspect-row"
            role="button"
            tabIndex={0}
            className="flex items-center justify-between gap-2 py-1 cursor-pointer hover:bg-secondary"
            onClick={(e) => {
              e.stopPropagation();
              void copy(`${row.label} (light)`, token.light);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              handleActivationKeyDown(() => void copy(`${row.label} (light)`, token.light))(e);
            }}
          >
            <span className="text-text-muted text-xs">Light</span>
            <span className="font-mono text-xs text-text-primary truncate">{token.light}</span>
          </div>
          <div
            data-testid="inspect-row"
            role="button"
            tabIndex={0}
            className="flex items-center justify-between gap-2 py-1 cursor-pointer hover:bg-secondary"
            onClick={(e) => {
              e.stopPropagation();
              void copy(`${row.label} (dark)`, token.dark);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              handleActivationKeyDown(() => void copy(`${row.label} (dark)`, token.dark))(e);
            }}
          >
            <span className="text-text-muted text-xs">Dark</span>
            <span className="font-mono text-xs text-text-primary truncate">{token.dark}</span>
          </div>
        </div>
      )}
    </div>
  );
}
