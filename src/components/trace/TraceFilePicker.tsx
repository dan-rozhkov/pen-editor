import { FileArrowUpIcon } from "@/components/icons";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { readBrowseTraceFile } from "@/lib/browseTraceFile";
import type { TraceLoadResult } from "@/lib/browseTraceLoad";
import { cn } from "@/lib/utils";
import { TraceViewer } from "./TraceViewer";

/** "/trace": open a trace from a file chosen or dropped on the page; it stays in memory. */
export function TraceFilePicker() {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<TraceLoadResult | null>(null);
  const [over, setOver] = useState(false);

  const open = async (file: File | undefined) => {
    if (file) setResult(await readBrowseTraceFile(file));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void open(e.dataTransfer.files[0]);
  };

  if (result?.ok) return <TraceViewer key={result.trace.id} trace={result.trace} deepLink={false} />;
  return (
    <main
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="trace-drop"
      className={cn("flex h-dvh items-center justify-center bg-surface-panel px-4", over && "outline-2 -outline-offset-8 outline-dashed outline-ring")}
    >
      <EmptyState
        titleAs="h1"
        icon={<FileArrowUpIcon size={32} weight="light" />}
        title="Open a trace file"
        description={
          <>
            Drop a trace .json file here, or choose one.
            {result && !result.ok && (
              <span role="alert" className="mt-2 block text-destructive">
                This file could not be opened.
                <code className="mt-1 block break-words rounded-md bg-surface-elevated px-2 py-1 font-mono text-[11px] text-text-secondary">{result.message}</code>
              </span>
            )}
          </>
        }
        action={
          <>
            <Button variant="outline" onClick={() => input.current?.click()}>
              Choose a file
            </Button>
            <input ref={input} type="file" accept=".json,application/json" aria-label="Trace file" hidden onChange={(e) => {
                const chosen = e.target.files?.[0];
                e.target.value = ""; // choosing the same file again must fire onChange
                void open(chosen);
              }} />
          </>
        }
      />
    </main>
  );
}
