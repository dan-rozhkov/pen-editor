import { useEffect, useState } from "react";
import { useVariableStore } from "@/store/variableStore";
import { buildUsageReport, type LibraryUsage, type UsageReport } from "@/lib/dsReport";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

const pct = (part: number, whole: number) => (whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`);

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-primary tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-text-primary">{title}</h3>
      <dl className="text-xs">{children}</dl>
    </section>
  );
}

/** Names of the library's unused tokens and keys of its unused components, with a marker for what the list cut off. */
function UnusedList({ lib }: { lib: LibraryUsage }) {
  const variables = useVariableStore((st) => st.variables);
  if (lib.unusedTokenIds.length + lib.unusedComponentKeys.length === 0) return null;
  const nameOf = (id: string) => variables.find((v) => v.id === id)?.name ?? id;
  const moreTokens = lib.tokens.unused - lib.unusedTokenIds.length;
  const moreComponents = lib.components.unused - lib.unusedComponentKeys.length;
  const group = (label: string, items: string[], more: number) =>
    items.length === 0 ? null : (
      <p className="mt-1 break-words">
        {label}: {items.join(", ")}
        {more > 0 ? ` and ${more} more` : ""}
      </p>
    );
  return (
    <details className="text-xs text-text-muted">
      <summary className="cursor-pointer">Unused</summary>
      {group("Components", lib.unusedComponentKeys, moreComponents)}
      {group("Tokens", lib.unusedTokenIds.map(nameOf), moreTokens)}
    </details>
  );
}

export function UsageReportView({ report }: { report: UsageReport }) {
  const { tokens, components, lint, libraries } = report;
  const lintRules = lint ? Object.entries(lint).filter(([, n]) => n > 0) : [];
  return (
    <div className="space-y-4">
      {report.truncated && (
        <p role="status" className="text-xs text-text-muted">
          The scan stopped at a limit, so some numbers may be low.
        </p>
      )}
      <Section title="Tokens">
        <Row label="Coverage (bound of bindable)" value={`${pct(tokens.bound, tokens.bindable)} (${tokens.bound} of ${tokens.bindable})`} />
        <Row label="Bound to a library token" value={tokens.boundToLibrary} />
        <Row label="Using a paint style" value={tokens.styled} />
        <Row label="Hardcoded values left" value={tokens.literal} />
        <Row label="Embed CSS: var() references" value={tokens.embed.varRefs} />
        <Row label="Embed CSS: var() to unknown names" value={tokens.embed.unknownVarRefs} />
        <Row label="Embed CSS: hardcoded colors" value={tokens.embed.literals} />
        {tokens.cssNameCollisions > 0 && <Row label="Tokens sharing a CSS name" value={tokens.cssNameCollisions} />}
      </Section>
      <Section title="Components">
        <Row label="Instances" value={components.instances} />
        <Row label="From a library" value={components.libraryInstances} />
        <Row label="Detached copies" value={components.detached} />
      </Section>
      <Section title="Lint (active page)">
        {lint === null ? (
          <Row label="Not available" value="-" />
        ) : lintRules.length === 0 ? (
          <Row label="Findings" value={0} />
        ) : (
          lintRules.map(([rule, n]) => <Row key={rule} label={rule} value={n} />)
        )}
      </Section>
      <Section title="Libraries">
        {libraries.length === 0 && <Row label="No linked library" value="-" />}
      </Section>
      {libraries.map((lib) => (
        <section key={lib.libraryId} className="space-y-1">
          <h4 className="text-xs font-medium text-text-primary">
            {lib.libraryId}
            {lib.version ? ` @ ${lib.version}` : ""}
          </h4>
          <dl className="text-xs">
            <Row label="Tokens used" value={`${lib.tokens.used} of ${lib.tokens.total}`} />
            <Row label="Components used" value={`${lib.components.used} of ${lib.components.total}`} />
          </dl>
          <UnusedList lib={lib} />
        </section>
      ))}
    </div>
  );
}

/** Variables panel: adoption numbers for this document. Computed on the device; nothing is sent. */
export function UsageReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [run, setRun] = useState(0);
  // Kept after close, so the dialog does not change height while it fades out.
  const [report, setReport] = useState<UsageReport | null>(null);

  useEffect(() => {
    if (!open) return;
    // Off the render phase: the scan can take a moment on a large document.
    const timer = setTimeout(() => setReport(buildUsageReport()), 0);
    return () => clearTimeout(timer);
  }, [open, run]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Usage report</DialogTitle>
          <DialogDescription>Counts for this document, computed here. Nothing is sent.</DialogDescription>
        </DialogHeader>
        {report ? (
          <UsageReportView report={report} />
        ) : (
          <p role="status" className="text-xs text-text-muted">
            Calculating…
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setRun((n) => n + 1)}>
            Refresh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
