import { useMemo } from "react";
import type { ExportSetting } from "@/types/scene";
import { useDevExportStore } from "@/store/devExportStore";
import { createExportSetting } from "@/utils/exportSettingsUtils";
import { ExportSettingsList } from "@/components/properties/ExportSettingsList";
import { ReadOnlyProvider } from "@/components/ReadOnlyProvider";

interface Props {
  nodeId: string;
  nodeName: string | undefined;
  exportSettings: ExportSetting[] | undefined;
}

/**
 * Dev Mode's "Export" section (dev-03). Dev Mode is read-only (dev-01), so
 * unlike `ExportSettingsSection` (Design mode) this never calls back into the
 * node/`.pen` document: edits go to `useDevExportStore`, an ephemeral
 * session-only override keyed by node id (cleared on `devModeStore.setActive
 * (false)`).
 *
 * - Untouched in Dev Mode -> shows `node.exportSettings` exactly as the
 *   designer configured it.
 * - Touched in Dev Mode -> the override *replaces* the list entirely for
 *   that node (no per-row merge with the document's settings), *including*
 *   an explicitly-emptied override (`[]`) — that renders as zero rows, same
 *   as Design mode, rather than resurrecting a default row (finding 5).
 * - Untouched *and* empty (no override key at all, and no node
 *   `exportSettings`) -> shows one default PNG @1x row so "open Dev Mode,
 *   export" works in a single click, without ever writing that default back
 *   to the node.
 */
export function DevExportSection({ nodeId, nodeName, exportSettings }: Props) {
  const override = useDevExportStore((s) => s.overrides[nodeId]);
  // Distinguish "never touched in Dev Mode" (key absent) from "explicitly
  // emptied" (key present, value `[]`) — `override` alone can't tell them
  // apart since both read as an empty/undefined value.
  const hasOverride = useDevExportStore((s) => Object.prototype.hasOwnProperty.call(s.overrides, nodeId));
  const setOverride = useDevExportStore((s) => s.setOverride);

  // The default row's id must stay stable across re-renders for the *same*
  // untouched node — otherwise its React list key (and thus DOM identity)
  // churns on every unrelated recompute. Memoized on `nodeId` alone (not on
  // `exportSettings`/`override`) so it survives even if a re-render passes a
  // new-but-still-empty `exportSettings` array reference for the same node.
  // createExportSetting() itself takes no arguments — the dep array is used
  // purely as a change-detection key, hence the eslint-disable below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaultRow = useMemo(() => createExportSetting(), [nodeId]);

  const settings = useMemo(() => {
    if (hasOverride) return override ?? [];
    const base = exportSettings ?? [];
    return base.length > 0 ? base : [defaultRow];
  }, [hasOverride, override, exportSettings, defaultRow]);

  return (
    // Dev Mode is read-only for the *document*: App.tsx wraps `<RightPanel />`
    // (and thus this whole panel) in `<ReadOnlyProvider value={isView ||
    // isDev}>`, and every PropertyInputs primitive (SelectInput/TextInput/
    // etc.) honors that by no-op'ing its onChange. That's correct for the
    // rest of Dev Mode (measurements/inspect rows/layers must never edit the
    // node) but it would also silently disable every control below —
    // format/scale selects, suffix, custom scale — even though none of them
    // write to the node. Opting back out to non-read-only here is safe
    // *only* because every edit below is routed to `setOverride` /
    // `useDevExportStore`, an ephemeral session-only store, never back into
    // sceneStore or the node's `exportSettings` (see the module doc above).
    <ReadOnlyProvider value={false}>
      <ExportSettingsList
        // Remounts the list (and its internal isExporting/status state) on
        // node switch — otherwise a stale "Exported N files." from the
        // previous node's export would show under the newly selected one
        // (finding 3).
        key={nodeId}
        nodeId={nodeId}
        nodeName={nodeName}
        settings={settings}
        onChange={(next) => setOverride(nodeId, next)}
        hideHeader
      />
    </ReadOnlyProvider>
  );
}
