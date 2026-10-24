import { CheckIcon, ListIcon } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { canListLocalTraces, listLocalTraces, type TraceListResult } from "@/lib/browseTraceList";
import type { TraceSource } from "@/lib/browseTraces";
import { describeOutcomeOf, clip, goalFirstLine } from "./traceModel";

interface Props {
  currentId: string;
  source: TraceSource;
}

const whenFormat: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };

/** Lists the saved local traces (desktop shell only) and opens another one. Hidden where the shell cannot list. */
export function TraceSwitcher({ currentId, source }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // The last answer stays while a newer one loads.
  const [result, setResult] = useState<TraceListResult | null>(null);
  const available = canListLocalTraces();
  // Only the latest open's answer counts; a slower older one must not overwrite it.
  const requestId = useRef(0);

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    const mine = ++requestId.current;
    void listLocalTraces().then((next) => {
      if (mine !== requestId.current) return;
      if (!next.ok) console.warn("Could not load traces:", next.message);
      setResult(next);
    });
  }, []);

  const open = (id: string) => {
    const next = new URLSearchParams(params);
    next.delete("step");
    next.set("src", "local");
    navigate(`/trace/${encodeURIComponent(id)}?${next.toString()}`);
  };

  if (!available) return null;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <IconButton variant="ghost" size="icon" tooltip="Traces" aria-label="Traces">
            <ListIcon className="size-4" weight="light" />
          </IconButton>
        }
      />
      <DropdownMenuContent align="start" sideOffset={4} className="max-h-80 min-w-56 overflow-y-auto">
        {result === null ? (
          <DropdownMenuItem disabled>Loading traces…</DropdownMenuItem>
        ) : !result.ok ? (
          <DropdownMenuItem disabled>
            <span className="flex min-w-0 flex-col">
              <span>Could not load traces.</span>
              <span className="truncate text-xs text-text-muted">{result.message}</span>
            </span>
          </DropdownMenuItem>
        ) : result.traces.length === 0 ? (
          <DropdownMenuItem disabled>No saved traces</DropdownMenuItem>
        ) : (
          result.traces.map((t) => {
            const current = source === "local" && t.id === currentId;
            return (
              <DropdownMenuItem key={t.id} onClick={() => !current && open(t.id)}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{clip(goalFirstLine(t.goal), 60)}</span>
                  <span className="truncate text-xs text-text-muted">
                    {new Date(t.startedAt).toLocaleString(undefined, whenFormat)} · {describeOutcomeOf(t).label}
                  </span>
                </span>
                {current && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
