import type { SceneNode } from "@/types/scene";
import type { ExportSetting } from "@/types/scene";
import { ExportSettingsList } from "@/components/properties/ExportSettingsList";

interface Props {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

/**
 * Per-node "Export" panel section for Design mode: wires the shared
 * presentational `ExportSettingsList` to `node.exportSettings`, mutating the
 * node through `onUpdate` like every other property section (`ShaderSection`
 * is the template) — this is the `.pen`-document-writing source. Dev mode's
 * `DevExportSection` (dev-03, `src/components/inspect/DevExportSection.tsx`)
 * renders the same `ExportSettingsList` against an ephemeral session-only
 * override store instead, since Dev Mode must stay read-only.
 */
export function ExportSettingsSection({ node, onUpdate }: Props) {
  const setSettings = (next: ExportSetting[]) => onUpdate({ exportSettings: next });

  return (
    <ExportSettingsList
      nodeId={node.id}
      nodeName={node.name}
      settings={node.exportSettings ?? []}
      onChange={setSettings}
    />
  );
}
