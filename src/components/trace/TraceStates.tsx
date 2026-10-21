import { FileXIcon, MagnifyingGlassIcon, PlugsIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { TraceLoadResult } from "@/lib/browseTraceLoad";

function Bar({ className }: { className: string }) {
  return <div className={`rounded-md bg-surface-elevated motion-safe:animate-pulse ${className}`} />;
}

/** Shape of the loaded page, so nothing jumps when the trace arrives. */
export function TraceSkeleton() {
  return (
    <div role="status" aria-label="Loading trace" className="flex h-dvh flex-col bg-surface-panel">
      <div className="space-y-3 border-b border-border-default bg-surface-panel px-4 py-3">
        <Bar className="h-5 w-2/3" />
        <Bar className="h-3.5 w-1/2" />
      </div>
      <div className="flex gap-2 border-b border-border-default bg-surface-panel px-4 py-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} className="h-12 w-[76px] shrink-0" />
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 min-[900px]:grid-cols-[19rem_1fr_24rem]">
        <div className="hidden space-y-3 border-e border-border-default bg-surface-panel p-4 min-[900px]:block">
          {Array.from({ length: 6 }, (_, i) => (
            <Bar key={i} className="h-9" />
          ))}
        </div>
        <div className="p-4">
          <Bar className="h-full min-h-64" />
        </div>
        <div className="hidden space-y-3 border-s border-border-default bg-surface-panel p-4 min-[900px]:block">
          <Bar className="h-8" />
          <Bar className="h-32" />
        </div>
      </div>
    </div>
  );
}

function Message({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="flex h-dvh items-center justify-center bg-surface-panel px-4">
      <EmptyState titleAs="h1" icon={icon} title={title} description={children} action={action} />
    </main>
  );
}

type Failure = Extract<TraceLoadResult, { ok: false }>;

/** Secondary way out of a dead end: pick a trace file instead. */
const openFile = (
  <Link to="/trace" className={buttonVariants({ variant: "outline" })}>
    Open a trace file
  </Link>
);

export function TraceFailure({ failure, onRetry }: { failure: Failure; onRetry(): void }) {
  switch (failure.reason) {
    case "not-found":
      return (
        <Message icon={<MagnifyingGlassIcon weight="light" />} title="Trace not found" action={openFile}>
          It may have been deleted, or the link is wrong.
        </Message>
      );
    case "no-bridge":
      return (
        <Message icon={<PlugsIcon weight="light" />} title="Open this trace in the desktop app">
          {failure.message}
        </Message>
      );
    case "invalid":
      return (
        <Message icon={<FileXIcon weight="light" />} title="This is not a Sideform trace" action={openFile}>
          The file is not in a format this viewer knows.
          <code className="mt-2 block break-words rounded-md bg-surface-elevated px-2 py-1 font-mono text-[11px] text-text-secondary">{failure.message}</code>
        </Message>
      );
    default:
      return (
        <Message
          icon={<WarningCircleIcon weight="light" />}
          title="The trace could not be loaded"
          action={
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          {failure.message}
        </Message>
      );
  }
}
