import { useRef, useState } from "react";
import { toast } from "sonner";
import { PlayIcon, TrashIcon, CodeIcon, DownloadSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { usePluginStore } from "@/store/pluginStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import { runPlugin } from "@/lib/plugins/pluginHost";
import { exportPluginToFile, parsePluginImport } from "@/lib/plugins/pluginTransfer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { EditableText } from "@/components/ui/EditableText";
import { Textarea } from "@/components/ui/textarea";
import { PanelEmptyState } from "@/components/PanelEmptyState";

/** Which per-plugin dialog (if any) is open, and for which plugin — replaces
 * two parallel `id | null` states (+ their `plugins.find()`s) with one. */
type ActiveDialog = { kind: "code" | "delete"; id: string } | null;

/**
 * Left-sidebar panel for installed plugins (reachable via the Toolbox rail
 * icon, or the "Manage plugins…" command palette entry which navigates
 * here). Lists installed plugins with run/rename/view-code/delete/export
 * actions, plus JSON import.
 */
export function PluginsPanel() {
  const plugins = usePluginStore((s) => s.plugins);
  const rename = usePluginStore((s) => s.rename);
  const remove = usePluginStore((s) => s.remove);
  const install = usePluginStore((s) => s.install);
  // Dev (inspect) mode is read-only, mirroring the `mutatesScene` guard that
  // hides per-plugin Run commands from the command palette (pluginCommands.ts)
  // — a plugin can call scene-mutating tools, so Run must not be reachable
  // from here either while dev mode is active. The sidebar (and this panel
  // with it) is also visible in VIEW mode, which is read-only via
  // ReadOnlyProvider — Run must be disabled there too.
  const isDevMode = useDevModeStore((s) => s.active);
  const isReadOnly = useReadOnly();

  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const viewingPlugin =
    activeDialog?.kind === "code" ? (plugins.find((p) => p.id === activeDialog.id) ?? null) : null;
  const deletingPlugin =
    activeDialog?.kind === "delete" ? (plugins.find((p) => p.id === activeDialog.id) ?? null) : null;

  async function handleImportFile(file: File): Promise<void> {
    const result = parsePluginImport(await file.text());
    if (!result.ok) {
      toast(
        result.reason === "invalid-json"
          ? "That file isn't valid JSON."
          : "That file doesn't look like a plugin export.",
      );
      return;
    }
    const installed = await install(result.input);
    toast(`Imported "${installed.name}".`);
  }

  return (
    <div className="flex h-full flex-col">
      <p className="px-3 pt-3 pb-2 text-xs text-text-muted">
        Installed generative plugins. Run one from here or from the command palette.
      </p>

      <div className="flex-1 flex flex-col gap-2 overflow-y-auto px-2">
        {plugins.length === 0 && (
          <PanelEmptyState icon={null}>No plugins installed yet.</PanelEmptyState>
        )}
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="flex items-start gap-2 rounded-md bg-secondary px-2 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {plugin.icon && <span aria-hidden>{plugin.icon}</span>}
                <EditableText
                  value={plugin.name}
                  onCommit={(name) => void rename(plugin.id, name)}
                  className="text-xs font-medium text-text-primary truncate"
                />
              </div>
              <p className="text-xs text-text-muted truncate px-2">{plugin.description}</p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <span
                title={
                  isDevMode
                    ? "Run is disabled in Dev Mode"
                    : isReadOnly
                      ? "Run is disabled in view mode"
                      : undefined
                }
              >
                <IconButton
                  tooltip="Run"
                  size="icon-sm"
                  variant="ghost"
                  disabled={isDevMode || isReadOnly}
                  onClick={() => runPlugin(plugin)}
                >
                  <PlayIcon />
                </IconButton>
              </span>
              <IconButton
                tooltip="View code"
                size="icon-sm"
                variant="ghost"
                onClick={() => setActiveDialog({ kind: "code", id: plugin.id })}
              >
                <CodeIcon />
              </IconButton>
              <IconButton
                tooltip="Export"
                size="icon-sm"
                variant="ghost"
                onClick={() => exportPluginToFile(plugin)}
              >
                <DownloadSimpleIcon />
              </IconButton>
              <IconButton
                tooltip="Delete"
                size="icon-sm"
                variant="ghost"
                onClick={() => setActiveDialog({ kind: "delete", id: plugin.id })}
              >
                <TrashIcon />
              </IconButton>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end px-3 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleImportFile(file);
          }}
        />
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <UploadSimpleIcon data-icon="inline-start" />
          Import…
        </Button>
      </div>

      <Dialog open={viewingPlugin != null} onOpenChange={(next) => !next && setActiveDialog(null)}>
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{viewingPlugin?.name}</DialogTitle>
            <DialogDescription>Read-only — code lives in this plugin's stored record.</DialogDescription>
          </DialogHeader>
          <Textarea value={viewingPlugin?.code ?? ""} readOnly className="min-h-64 font-mono text-xs" />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deletingPlugin != null} onOpenChange={(next) => !next && setActiveDialog(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingPlugin?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the plugin library and the command palette. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deletingPlugin) void remove(deletingPlugin.id);
                setActiveDialog(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
