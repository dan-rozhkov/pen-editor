import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { CubeIcon, MagnifyingGlassIcon, WarningIcon } from "@phosphor-icons/react";
import type { ComponentMaster } from "@/lib/embedComponents";
import { countUsage, type ComponentUsage } from "@/store/componentOps";
import { selectComponentRegistry, selectDuplicateMasters } from "@/store/componentRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import { goToMaster, insertInstance, insertTargetEmbed } from "@/lib/componentPanelActions";
import { isLibraryComponent, libraryLabel } from "@/lib/designSystem/ownership";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { ComponentMetaForm } from "@/components/componentsPanel/ComponentMetaForm";

interface Row {
  master: ComponentMaster;
  usage: ComponentUsage;
  duplicates: number;
}

const STATUS_LABEL = { draft: "Draft", stable: "Stable", deprecated: "Deprecated" } as const;
const STATUS_VARIANT = { draft: "outline", stable: "secondary", deprecated: "destructive" } as const;

function findInsertTargetId(selectedIds: readonly string[], ..._changed: unknown[]): string | null {
  return insertTargetEmbed(selectedIds)?.id ?? null;
}

function describeUsage(usage: ComponentUsage): string {
  if (usage.instances === 0) return "Not used yet";
  const uses = `${usage.instances} ${usage.instances === 1 ? "use" : "uses"}`;
  return `${uses} in ${usage.embeds} ${usage.embeds === 1 ? "screen" : "screens"}`;
}

/**
 * The registry is derived from the store snapshots (`getState`), so the
 * subscribed values below only mark when to recompute; the builder ignores them.
 */
function buildRows(..._changed: unknown[]): Row[] {
  const registry = selectComponentRegistry();
  const usage = countUsage(registry);
  const duplicates = selectDuplicateMasters();
  return Array.from(registry.values()).map((master) => ({
    master,
    usage: usage.get(master.key) ?? { instances: 0, embeds: 0 },
    duplicates: duplicates.get(master.key)?.length ?? 0,
  }));
}

/** Registered components over every page and the live scene. */
function useComponentRows(): Row[] {
  const nodesById = useSceneStore((s) => s.nodesById);
  const pages = usePageStore((s) => s.pages);
  const activePageId = usePageStore((s) => s.activePageId);
  return useMemo(() => buildRows(nodesById, pages, activePageId), [nodesById, pages, activePageId]);
}

interface ComponentRowViewProps {
  row: Row;
  otherKeys: string[];
  insertTarget: string | null;
  readOnly: boolean;
}

function ComponentRowView({ row, otherKeys, insertTarget, readOnly }: ComponentRowViewProps) {
  const { master, usage, duplicates } = row;
  const { meta } = master;
  const [editing, setEditing] = useState(false);
  const detailsId = useId();
  const isLibrary = isLibraryComponent(meta);

  function handleInsert() {
    if (!insertTarget) return;
    const result = insertInstance(meta.key, insertTarget);
    if (result.ok) toast.success(`Inserted "${meta.name}" into "${result.embedName}".`);
    else toast.error(result.error);
  }

  const variants = Object.entries(meta.variants ?? {});

  return (
    <li
      data-testid={`component-row-${meta.key}`}
      className="flex flex-col gap-1.5 rounded-lg border border-border-default p-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 truncate text-xs font-medium text-text-primary">{meta.name}</span>
        <code className="text-[10px] text-text-muted">{meta.key}</code>
        {meta.status && <Badge variant={STATUS_VARIANT[meta.status]}>{STATUS_LABEL[meta.status]}</Badge>}
        {isLibrary && meta.library && <Badge variant="outline">Library: {libraryLabel(meta.library.id)}</Badge>}
      </div>
      {meta.description && <p className="text-[11px] text-text-muted">{meta.description}</p>}
      {meta.status === "deprecated" && (meta.deprecated?.replacedBy || meta.deprecated?.note) && (
        <p className="text-[11px] text-text-muted">
          {meta.deprecated.replacedBy && <>Use {meta.deprecated.replacedBy} instead. </>}
          {meta.deprecated.note}
        </p>
      )}
      {duplicates > 0 && (
        <p role="note" className="flex items-start gap-1 text-[11px] text-destructive">
          <WarningIcon aria-hidden size={12} className="mt-0.5 shrink-0" />
          <span>
            Duplicate key: {duplicates} more {duplicates === 1 ? "master uses" : "masters use"} it. Only the first
            is used. Delete the extra copies.
          </span>
        </p>
      )}
      <p className="text-[11px] text-text-muted">{describeUsage(usage)}</p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Go to master, ${meta.name}`}
          onClick={() => goToMaster(meta.key)}
        >
          Go to master
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Insert instance, ${meta.name}`}
          disabled={readOnly || !insertTarget}
          onClick={handleInsert}
        >
          Insert instance
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={editing}
          aria-controls={detailsId}
          aria-label={`${isLibrary ? "Details" : "Edit details"}, ${meta.name}`}
          onClick={() => setEditing((v) => !v)}
        >
          {isLibrary ? "Details" : "Edit details"}
        </Button>
      </div>
      <div id={detailsId} hidden={!editing}>
        {editing &&
          (isLibrary || readOnly ? (
            <div className="flex flex-col gap-1 border-t border-border-default pt-2 text-[11px] text-text-muted">
              <p>{isLibrary ? "Library component. Edit it in the library document." : "Read-only view."}</p>
              {variants.length > 0 && (
                <p>Variants: {variants.map(([axis, values]) => `${axis} (${values.join(", ")})`).join("; ")}</p>
              )}
            </div>
          ) : (
            <ComponentMetaForm master={master} otherKeys={otherKeys} onDone={() => setEditing(false)} />
          ))}
      </div>
    </li>
  );
}

/**
 * Left-sidebar panel listing the document's registered embed components:
 * search, status and library badges, usage counts, duplicate-key warnings,
 * "Go to master", "Insert instance" into the selected screen, and a meta
 * editor for local masters.
 */
export function ComponentsPanel() {
  const rows = useComponentRows();
  const readOnly = useReadOnly();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const nodesById = useSceneStore((s) => s.nodesById);
  const [query, setQuery] = useState("");

  const insertTarget = useMemo(
    () => findInsertTargetId(selectedIds, nodesById),
    [selectedIds, nodesById],
  );

  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? rows.filter(({ master }) =>
        `${master.meta.name} ${master.key} ${master.meta.description ?? ""}`.toLocaleLowerCase().includes(needle),
      )
    : rows;
  const keys = useMemo(() => rows.map((r) => r.master.key), [rows]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[49px] shrink-0 items-center gap-2 border-b border-border-default px-4 py-3">
        <h2 className="flex-1 text-sm font-medium text-text-primary">Components</h2>
        <span className="text-[11px] text-text-muted">{rows.length}</span>
      </div>
      <div className="relative px-3 pt-3 pb-2">
        <MagnifyingGlassIcon
          aria-hidden
          size={14}
          className="pointer-events-none absolute top-[26px] left-5 -translate-y-1/2 text-text-muted"
        />
        <Input
          aria-label="Search components"
          placeholder="Search components…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 pl-7"
        />
      </div>
      {rows.length > 0 && !insertTarget && !readOnly && (
        <p className="px-4 pb-2 text-[11px] text-text-muted">Select a screen to insert an instance.</p>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {rows.length === 0 ? (
          <PanelEmptyState icon={<CubeIcon aria-hidden size={28} weight="light" />}>
            No components yet. Ask the agent to extract one from a screen.
          </PanelEmptyState>
        ) : visible.length === 0 ? (
          <PanelEmptyState icon={null}>No components found.</PanelEmptyState>
        ) : (
          <ul aria-label="Components" className="flex flex-col gap-2">
            {visible.map((row) => (
              <ComponentRowView
                key={row.master.key}
                row={row}
                otherKeys={keys.filter((k) => k !== row.master.key)}
                insertTarget={insertTarget}
                readOnly={readOnly}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
