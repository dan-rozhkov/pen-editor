import { useState } from "react";
import { BrainIcon, CaretDownIcon } from "@phosphor-icons/react";
import { formatChange, type ChangeDetail } from "@/lib/memoryActivity";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";

// "The agent changed itself" row. Shared by the in-turn `memory` /
// `skill_manage` successes and the background-review notes, so a self-change
// looks the same wherever it comes from. Collapsed by default; the details say
// WHAT changed. Without details (older backend, or a tool input we could not
// read) there is nothing to expand, so no chevron. Looks and behaves like
// ToolCallIndicator's row.
export function MemoryActivityRow({ changes }: { changes?: ChangeDetail[] }) {
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <BrainIcon size={14} className="shrink-0" />
      <span className="truncate">Memory updated</span>
    </>
  );

  if (!changes || changes.length === 0) {
    return (
      <div className="my-0.5 py-0.5 flex items-center gap-1.5 text-[13px] leading-relaxed text-text-muted">
        {label}
      </div>
    );
  }

  return (
    <div className="my-0.5">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 w-full py-0.5 text-[13px] leading-relaxed text-text-muted hover:text-text-secondary"
      >
        {label}
        <CaretDownIcon
          size={10}
          className={`transition-transform duration-250 ease-smooth-out shrink-0 ${open ? "" : "-rotate-90"}`}
          weight={CHEVRON_WEIGHT}
        />
      </button>
      {open && (
        <ul className="mt-1 mb-1.5 space-y-1 p-2 rounded bg-surface-elevated text-[13px] leading-relaxed text-text-muted min-w-0">
          {changes.map((c, i) => (
            <li key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {formatChange(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
